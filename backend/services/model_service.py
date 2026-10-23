"""
model_service.py
================
Service layer for model upload, loading, and architecture inspection.

Wraps existing functions from:
  - core/model_loader.py : load_model_from_file, get_model_architecture_summary
  - core/dynamic_intervener.py : DynamicSciMLIntervener, generate_test_data
"""

import json
import os
import sys
import tempfile
import torch

from core.model_loader import load_model_from_file, get_model_architecture_summary
from core.dynamic_intervener import DynamicSciMLIntervener, generate_test_data
from backend.session_manager import ModelSession, session_store


def _build_minimal_graph_from_arch(arch_summary: dict, filename_py: str) -> dict:
    """Synthesize a model-agnostic minimal graph schema when no graph.json is uploaded."""
    in_dim = arch_summary.get("input_dim") or 1
    out_dim = arch_summary.get("output_dim") or 1
    class_name = arch_summary.get("class_name", "PINN")

    in_names = ["t"] if in_dim == 1 else (["t", "x"] if in_dim == 2 else [f"x_{i+1}" for i in range(in_dim)])
    out_names = ["u"] if out_dim == 1 else [f"u_{i+1}" for i in range(out_dim)]

    nodes = []
    edges = []
    for name in in_names:
        nodes.append({
            "id": name,
            "label": f"Input ({name})",
            "symbol": name,
            "type": "input",
            "description": f"Input coordinate '{name}' to {class_name}.",
        })
    for lyr in arch_summary.get("layers", []):
        if "weight" in lyr["name"]:
            lid = lyr["name"]
            nodes.append({
                "id": lid,
                "label": f"Layer {lid}",
                "symbol": lid.split(".")[0],
                "type": "intermediate",
                "description": f"Neural weight tensor {lid} with shape {lyr['shape']}.",
            })
    for oname in out_names:
        nodes.append({
            "id": oname,
            "label": f"Output ({oname})",
            "symbol": oname,
            "type": "output",
            "description": f"Predicted field '{oname}' from {class_name}.",
        })

    # Connect inputs -> first layer -> subsequent layers -> outputs
    weight_ids = [n["id"] for n in nodes if n["type"] == "intermediate"]
    if weight_ids:
        for in_id in in_names:
            edges.append({"source": in_id, "target": weight_ids[0], "label": "input"})
        for idx in range(len(weight_ids) - 1):
            edges.append({"source": weight_ids[idx], "target": weight_ids[idx + 1], "label": "forward"})
        for out_id in out_names:
            edges.append({"source": weight_ids[-1], "target": out_id, "label": "output"})
    else:
        for in_id in in_names:
            for out_id in out_names:
                edges.append({"source": in_id, "target": out_id, "label": "forward"})

    return {
        "metadata": {
            "system": f"{class_name} ({filename_py})",
            "equation": "Auto-inspected Neural Architecture",
            "description": f"Dynamically inspected {class_name} architecture ({arch_summary.get('total_params', 0)} parameters).",
            "pinn_input": ", ".join(in_names),
            "pinn_output": ", ".join(out_names),
        },
        "nodes": nodes,
        "edges": edges,
        "input_spec": {
            "names": in_names,
            "dim": in_dim,
            "ranges": {n: [0, 1] for n in in_names},
        },
        "output_spec": {
            "names": out_names,
            "dim": out_dim,
        },
        "parameters": {},
        "residual": {
            "formula": "",
            "description": "Upload a graph.json or use AI Ruleset Generation to attach governing PDE/ODE equations.",
            "derivatives": {
                out_names[0]: {"wrt": in_names, "order": 0}
            },
        },
        "expected_trends": {},
    }


def handle_model_upload(
    py_bytes: bytes,
    pt_bytes: bytes,
    graph_bytes: bytes | None = None,
    filename_py: str = "model.py",
) -> dict:
    """
    Load an uploaded PINN model + weights + optional graph.json, instantiate the
    intervener, generate synthetic test data, and store everything in the
    in-memory session store.
    """
    # 1. Write uploaded files to temp paths for loader ingestion
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False) as f_py:
        f_py.write(py_bytes)
        py_path = f_py.name

    with tempfile.NamedTemporaryFile(suffix=".pt", delete=False) as f_pt:
        f_pt.write(pt_bytes)
        pt_path = f_pt.name

    try:
        # 2. Load model using AST sanitizer from core/model_loader.py (auto-places on GPU if available)
        model = load_model_from_file(py_path=py_path, weights_path=pt_path)
        device = next(model.parameters(), torch.empty(0)).device

        # 3. Extract architecture summary
        arch_summary = get_model_architecture_summary(model)

        # 4. Parse graph JSON if provided, or auto-generate / synthesize from architecture
        if graph_bytes:
            try:
                graph_dict = json.loads(graph_bytes.decode("utf-8"))
            except Exception as exc:
                raise ValueError(f"Invalid graph.json: {exc}") from exc
        else:
            api_key = os.environ.get("OPENROUTER_API_KEY", "")
            if api_key:
                try:
                    from core.llm_engine import generate_graph_json
                    graph_dict = generate_graph_json(model_py_path=py_path, api_key=api_key)
                except Exception:
                    graph_dict = _build_minimal_graph_from_arch(arch_summary, filename_py)
            else:
                graph_dict = _build_minimal_graph_from_arch(arch_summary, filename_py)

        # 5. Instantiate DynamicSciMLIntervener from core/dynamic_intervener.py
        intervener = DynamicSciMLIntervener(model=model, graph=graph_dict)

        # 6. Generate synthetic test data via code generator in graph.json and move to GPU/device
        test_inputs, test_targets = generate_test_data(graph_dict)
        test_inputs = test_inputs.to(device)
        if test_targets is not None:
            test_targets = test_targets.to(device)

        # 7. Create and store ModelSession
        session_id = session_store.new_id()
        session = ModelSession(
            session_id=session_id,
            model=model,
            model_metadata=graph_dict.get("metadata", {}),
            graph_data=graph_dict,
            intervener=intervener,
            test_inputs=test_inputs,
            test_targets=test_targets,
        )
        session_store.create(session)

    finally:
        # Clean up temporary files from disk
        for p in (py_path, pt_path):
            try:
                if os.path.exists(p):
                    os.remove(p)
            except OSError:
                pass

    metadata = graph_dict.get("metadata", {})
    return {
        "session_id": session_id,
        "system": metadata.get("system", "Unknown"),
        "equation": metadata.get("equation", "Unknown"),
        "num_parameters": sum(p.numel() for p in model.parameters()),
        "architecture": arch_summary,
        "input_spec": graph_dict.get("input_spec", {}),
        "output_spec": graph_dict.get("output_spec", {}),
        "physics_params": list(graph_dict.get("parameters", {}).keys()),
        "test_input_shape": list(test_inputs.shape),
        "has_ground_truth": test_targets is not None,
    }


def get_architecture_summary(session_id: str) -> dict:
    """Retrieve the architecture summary for an existing session."""
    session = session_store.get(session_id)
    return get_model_architecture_summary(session.model)
