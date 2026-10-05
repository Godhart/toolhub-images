"""
Script does following:
1. reads and validates namespace configuration (using pydantic)
2. creates namespace's root data folder if not exists
3. generates `compose.yaml` in the root of namespace's root folder using jinja2 template (`compose.template.yaml`) and data from configuration. NOTE: single file for all hubs
4. generates `.env-<hub.name>` in the root of namespace's root folder using jinja2 template (`.toolhub-env.template`) and data from configuration. NOTE: one file per each hub, including router
5. creates necessary folders if not exists
   - data subfolders for every toolhub container (within <namespace_root>/data)
   - config subfolders for every toolhub container (within <namespace_root>/config)
   - tools folder
   - workspace folder
4. removes toolsets folders that are not specified in toolsets of config (if specified so via options)
5. populates toolsets
    - removes previous version for tools that should be always updated (except toolsets with manual source_kind)
    - retrieves necessary tools
6. for every hub generates toolpacks and saves them to config folder of this pack (`<namespace_root>/config/<hub_name>/<toolset>.toolpack`). path to scripts in toolpacks are converted accoring to volumes map and path within container (within /tool/<toolset>)
7. generates configuration data (`<namespace_root>/config/<hub_name>/toolhub.yaml`) for every worker hub with option to drop all previous settings
8. generates configuration data ((`<namespace_root>/config/_router_/toolhub.yaml`) for router hub (key setup here - references to worker hubs)
"""
