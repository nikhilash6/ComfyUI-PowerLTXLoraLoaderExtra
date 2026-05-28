def update_node_in_workflow(workflow, unique_id, callback):
    """
    Traverses the workflow (including subgraphs) to find the node with unique_id.
    If found, executes callback(node).

    Supports Nodes 2.0 subgraph paths where unique_id is colon-separated
    (e.g. "5:12" means node 12 inside subgraph node 5).
    """
    if not workflow:
        return

    # 1. Parse the unique_id path
    path = str(unique_id).split(':')

    # Start at root
    current_node_list = workflow.get("nodes", [])

    # 2. Traverse
    for index, path_id in enumerate(path):
        node_candidate = next(
            (x for x in current_node_list if str(x["id"]) == str(path_id)),
            None
        )

        if not node_candidate:
            return  # Path broken

        # 3. Check if leaf
        if index == len(path) - 1:
            # Found it! Execute the callback logic on this node
            callback(node_candidate)
            return

        # 4. Dive deeper into subgraph
        subgraph_uuid = node_candidate.get("type")
        subgraphs = workflow.get("definitions", {}).get("subgraphs", [])
        subgraph_def = next(
            (sg for sg in subgraphs if str(sg["id"]) == str(subgraph_uuid)),
            None
        )

        if subgraph_def:
            current_node_list = subgraph_def.get("nodes", [])
        else:
            return
