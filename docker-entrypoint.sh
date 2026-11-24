#!/usr/bin/env bash
set -u

# Run both PI WEB services in the foreground. pi-web start delegates to the
# host's systemd/launchd manager, which is not available in a normal container.
pi-web-sessiond &
sessiond_pid=$!
pi-web-server &
web_pid=$!

stop_services() {
    trap - TERM INT
    kill -TERM "$web_pid" "$sessiond_pid" 2>/dev/null || true
    wait "$web_pid" 2>/dev/null || true
    wait "$sessiond_pid" 2>/dev/null || true
}

trap 'stop_services; exit 0' TERM INT

# End the container if either service exits, and preserve its exit status.
set +e
wait -n "$web_pid" "$sessiond_pid"
status=$?
set -e

stop_services
exit "$status"
