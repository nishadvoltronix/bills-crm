// HUB only. The deployment controller supplies these nonsecret absolute paths.
// Never load backend.env here: PM2 serializes ecosystem environment to its dump.
const fs = require("node:fs");
const path = require("node:path");
const release = process.env.HUB_RELEASE_DIR;
const node = process.env.HUB_NODE_BIN;
const home = "/home/rjpmadmin";
const config = home + "/hub-config";
function ordinary(filename, directory) {
  if (typeof filename !== "string" || !path.isAbsolute(filename)
    || filename.includes("\n") || filename.includes("\r") || filename.includes("\0")
    || fs.realpathSync(filename) !== filename) throw Error("Invalid HUB process path.");
  const stat = fs.lstatSync(filename);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw Error("Invalid HUB process file.");
}
ordinary(release, true);
if (!/^\/var\/www\/hub\.voltronix_ae\/releases\/[0-9]{8}T[0-9]{6}Z-[a-f0-9]{40}-[a-f0-9]{8}$/.test(release)) {
  throw Error("HUB processes require an explicitly accepted or candidate release.");
}
ordinary(node, false);
ordinary(path.join(release, "tools/run-hub.mjs"), false);
const osEnvironment = {
  HOME: home, USER: "rjpmadmin", LOGNAME: "rjpmadmin",
  PATH: path.dirname(node) + ":/usr/local/bin:/usr/bin:/bin",
  PM2_HOME: home + "/.pm2",
};
function application(name, role) {
  return {
    name, cwd: release, script: path.join(release, "tools/run-hub.mjs"),
    interpreter: node, args: [role, "--env-file", config + "/" + (role === "api" ? "backend" : "frontend") + ".env"],
    exec_mode: "fork", instances: 1, autorestart: true, restart_delay: 3000,
    exp_backoff_restart_delay: 1000, min_uptime: "15s", max_restarts: 10,
    kill_timeout: 30000, listen_timeout: 60000, time: true,
    out_file: home + "/hub-deploy-logs/" + name + ".out.log",
    error_file: home + "/hub-deploy-logs/" + name + ".error.log",
    env: osEnvironment,
  };
}
module.exports = { apps: [application("hub-api", "api"), application("voltronix-hub", "web")] };
