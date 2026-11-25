# pi-agent Docker image

This image installs the Pi coding agent CLI and `pi-web`. Its default command starts the web interface on port `8504`:

```sh
docker run --rm -p 8504:8504 your-registry/pi-agent:tag
```

The image includes the `@mutualendemic/pi-web-codemirror-editor` package and
enables its **CodeMirror Editor** plugin by default. In the Files panel, choose
**Edit** for a supported text file. You can disable or re-enable the plugin in
**Settings → PI WEB plugins**; browser-only plugin changes take effect after a
page reload.

GitHub Actions uses release-please to create versioned GHCR images and update
the Argo CD deployment tag. See [the deployment guide](k8s/README.md) for setup
and release details.

The image runs as the non-root `node` user and uses `/workspace` as its working directory.

The container starts PI WEB's web server and session daemon directly. The `pi-web start` lifecycle command uses the host's user service manager, so it is not used in the container.

## Providing Pi configuration

Pi reads user configuration from `/home/node/.pi/agent` by default. Set `PI_CODING_AGENT_DIR` to use a different directory. Common files include:

- `models.json` for custom models, compatible endpoints, or model overrides.
- `auth.json` for credentials saved by Pi's interactive login flow.
- `settings.json` for Pi defaults and settings.
- `mcp.json`, extensions, skills, and prompt templates for additional integrations and resources.

You can provide these files at image build time, but runtime mounts are usually more convenient for configuration that differs by environment. Do not bake API keys or `auth.json` into an image. Provide provider keys as environment variables or mount credentials from a secret store. Pi supports environment interpolation in `models.json`, for example `${LLM_API_KEY}`.

### Example `models.json`

This example adds an OpenAI-compatible endpoint. Replace the URL and model details with values supported by your endpoint:

```json
{
  "$schema": "https://pi.dev/schemas/models.schema.json",
  "providers": {
    "internal": {
      "baseUrl": "https://llm.example.com/v1",
      "api": "openai-completions",
      "apiKey": "${LLM_API_KEY}",
      "models": [
        {
          "id": "coder-model",
          "name": "Coder model",
          "contextWindow": 128000,
          "maxTokens": 8192,
          "input": ["text"]
        }
      ]
    }
  }
}
```

Pi will refer to this model as `internal/coder-model`. Built-in providers often do not need a `models.json` entry: provide their documented API-key environment variable instead. See the [Pi configuration guide](https://github.com/earendil-works/pi/blob/main/docs/configuration.md), [model configuration reference](https://github.com/earendil-works/pi/blob/main/docs/models-configuration.md), and [provider list](https://github.com/earendil-works/pi/blob/main/docs/providers.md).

### Kubernetes ConfigMap and Secret

Store non-secret model configuration in a ConfigMap and credentials in a Secret (or your cluster's external secret manager). For example:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: pi-config
data:
  models.json: |
    {
      "$schema": "https://pi.dev/schemas/models.schema.json",
      "providers": {
        "internal": {
          "baseUrl": "https://llm.example.com/v1",
          "api": "openai-completions",
          "apiKey": "${LLM_API_KEY}",
          "models": [
            {
              "id": "coder-model",
              "name": "Coder model",
              "contextWindow": 128000,
              "maxTokens": 8192,
              "input": ["text"]
            }
          ]
        }
      }
    }
```

Create `pi-credentials` using your secret-management process with a key named `LLM_API_KEY`. Mount the ConfigMap file at the path Pi expects, and pass the key into the container from the Secret:

```yaml
env:
  - name: LLM_API_KEY
    valueFrom:
      secretKeyRef:
        name: pi-credentials
        key: LLM_API_KEY
volumeMounts:
  - name: pi-config
    mountPath: /home/node/.pi/agent/models.json
    subPath: models.json
    readOnly: true
volumes:
  - name: pi-config
    configMap:
      name: pi-config
```

Add the `volumeMounts` to the container and `volumes` to the pod template's `spec`. Mount additional files in the same way, or set `PI_CODING_AGENT_DIR` and mount the directory there. Kubernetes does not update files mounted with `subPath` in running pods; recreate pods after changing the ConfigMap. New CronJob pods will use the current ConfigMap.

For local Docker runs, mount a workspace and `models.json`, and forward a key already present in your shell:

```sh
docker run --rm \
  -v "$PWD:/workspace" \
  -v "$PWD/models.json:/home/node/.pi/agent/models.json:ro" \
  -e LLM_API_KEY \
  your-registry/pi-agent:tag
```

## Running scheduled tasks with Kubernetes CronJobs

No Dockerfile change is required to run scheduled tasks. The image's default command starts `pi-web`, but Kubernetes can override it with `command: ["pi"]`. Use Pi's `--print` option to run a prompt once and exit. `--no-session` makes each execution independent and avoids storing a Pi conversation session.

The following CronJob assumes that:

- `pi-config` and `pi-credentials` are configured as above.
- A PVC named `pi-workspace` contains the repository or other files Pi should work on. Pi runs in `/workspace`, so its tools see that mounted content. Use a suitable persistent volume for your storage class and required access mode.
- The image reference points to the image built from this Dockerfile.

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: pi-daily-task
spec:
  schedule: "0 6 * * 1-5" # 06:00 on weekdays, in the controller's timezone
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 300
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 1
      activeDeadlineSeconds: 1800
      ttlSecondsAfterFinished: 86400
      template:
        spec:
          restartPolicy: Never
          securityContext:
            fsGroup: 1000
          containers:
            - name: pi
              image: your-registry/pi-agent:tag
              workingDir: /workspace
              command: ["pi"]
              args:
                - "--print"
                - "--no-session"
                - "--model"
                - "internal/coder-model"
                - "Review the repository and update reports/daily.md with today's summary."
              env:
                - name: LLM_API_KEY
                  valueFrom:
                    secretKeyRef:
                      name: pi-credentials
                      key: LLM_API_KEY
              volumeMounts:
                - name: pi-config
                  mountPath: /home/node/.pi/agent/models.json
                  subPath: models.json
                  readOnly: true
                - name: workspace
                  mountPath: /workspace
          volumes:
            - name: pi-config
              configMap:
                name: pi-config
            - name: workspace
              persistentVolumeClaim:
                claimName: pi-workspace
```

Adjust `schedule`, model, prompt, image, PVC, and time limits for the task. The image runs as UID/GID `1000`; ensure the mounted workspace is writable by that user. The example sets `fsGroup: 1000`, which works with storage drivers that honor pod `fsGroup`; otherwise, provision the volume with suitable ownership and permissions. CronJob schedules use the Kubernetes controller's timezone by default; set `timeZone` if your cluster supports it and you want an explicit timezone. Without a workspace mount, each pod only sees the image's empty `/workspace`, so it will not have access to your repository. Pi's tools can edit files there, so use storage that retains the changes you want after the pod exits.

If you want Pi to resume a conversation across runs, omit `--no-session` and persist Pi's session data in its agent directory. For tasks that need project-local Pi settings, extensions, or other trust-gated resources from `.pi`, configure project trust deliberately; review those resources before enabling them for unattended runs.

Pi's `--print` output and Kubernetes logs provide a basic execution record. Use `kubectl logs` on the Job's pod to inspect a run. Configure external monitoring and alerts if failed or missed runs need attention.
