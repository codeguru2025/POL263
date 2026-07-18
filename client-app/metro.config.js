const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// client-app/ isn't a real npm workspace (see fxq/ and agent-app/ precedent — this repo
// has no workspaces config), just a sibling directory sharing a parent repo. The root
// POL263 web app also depends on react, and Metro's default hierarchical lookup walks up
// into the parent repo's node_modules and can resolve that copy instead of this project's
// own — two separate React instances in one bundle, a real class of bug (invalid hook
// calls, broken context), not a theoretical one (expo-doctor's duplicate-dependency check
// caught it in agent-app/). Blocking specifically the *root repo's* node_modules (not this
// project's own, including its legitimately-nested ones) fixes the leak without breaking
// normal nested resolution the way disabling hierarchical lookup entirely did.
const parentNodeModules = path.resolve(__dirname, "..", "node_modules");
const blockParentNodeModules = new RegExp(`^${parentNodeModules.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\\\.*$`);
config.resolver.blockList = Array.isArray(config.resolver.blockList)
  ? [...config.resolver.blockList, blockParentNodeModules]
  : [config.resolver.blockList, blockParentNodeModules].filter(Boolean);

module.exports = config;
