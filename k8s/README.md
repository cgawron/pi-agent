# Deploy with Argo CD

The manifests deploy `pi-web` as a single replica behind `oauth2-proxy`, expose
it on `agent.gawron.cloud` through Traefik, and persist Pi's agent data and
`/workspace` on separate PVCs. The app's ClusterIP service on port `8504` is
only used internally by the auth proxy.
The PVCs use the cluster's default StorageClass and request 5 GiB and 20 GiB.
Change these values in `base/persistent-volume-claims.yaml` to match your cluster.

## Configure the repository and image

Replace `OWNER` with the GitHub account or organization that owns this
repository in these files:

- `base/kustomization.yaml` (`ghcr.io/OWNER/pi-agent`)
- `base/deployment.yaml` (`ghcr.io/OWNER/pi-agent:main`)
- `argocd/application.yaml` (`https://github.com/OWNER/pi-agent.git`)

The workflow publishes `ghcr.io/<owner>/pi-agent` with branch, release, and
commit-SHA tags. It uses release-please with Conventional Commits: `feat:`
creates a minor release, `fix:` a patch release, and a `BREAKING CHANGE:` footer
creates a major release. On ordinary pushes to `main`, the workflow updates the
Kustomize tag to that commit's immutable `sha-...` tag. When a release-please PR
is merged, it publishes the versioned image (for example `v1.2.0`) and updates
the Kustomize tag to that release. Argo CD sees the Git change and syncs the
Deployment.

Enable **Allow GitHub Actions to create and approve pull requests** in the
repository's Actions settings so release-please can open release PRs. The
workflow also needs permission to push the image-tag update to the default
branch; allow GitHub Actions to update the manifest if branch protection rules
restrict direct pushes.

The GHCR package must be readable by your cluster. Make the package public for
unauthenticated pulls, or configure an `imagePullSecret` in the pod template
for a private package.

## Install the Argo CD application

After setting the repository owner above, apply the Application to the cluster
where Argo CD is installed:

```sh
kubectl apply -f k8s/argocd/application.yaml
```

The Application targets the `main` branch and enables automated sync, pruning,
and self-healing. Point `agent.gawron.cloud` DNS at the Traefik ingress address.
The Ingress uses the Traefik `letsencrypt` certificate resolver configured in
`base/ingress.yaml`.

## Configure OpenID Connect login

`oauth2-proxy` is the OIDC client and reverse proxy in front of `pi-web`. It
uses Keycloak at `https://keycloak.gawron.cloud/realms/private`. Register
`https://agent.gawron.cloud/oauth2/callback` as an allowed redirect URI for the
OIDC client. Access is restricted to exact email addresses listed in
`base/oauth2-proxy-allowlist.yaml`, one address per line. The list is empty by
default, so no user is allowed until you add an address. Keycloak must return
the user's email claim. For example:

```yaml
data:
  allowed-users.txt: |
    alice@example.com
    bob@example.net
```

Restart the `pi-agent-oauth2-proxy` Deployment after changing the allowlist so
the proxy reloads it.

Create a Kubernetes Secret named `pi-agent-oauth2-proxy-credentials` in the
`pi-agent` namespace through your secrets manager. It must contain keys named
`OAUTH2_PROXY_CLIENT_ID`, `OAUTH2_PROXY_CLIENT_SECRET`, and
`OAUTH2_PROXY_COOKIE_SECRET`. Generate the cookie secret with
`openssl rand -base64 32`. The Deployment intentionally requires this Secret,
so the Ingress will not forward traffic to the app until OIDC credentials are
configured. Keep these credentials out of Git.

## Configure credentials

Provide provider credentials as a Kubernetes Secret named
`pi-agent-credentials` in the `pi-agent` namespace. All keys in this Secret are
exposed as environment variables to the container; for example, use the key
expected by your configured model provider. The Secret reference is optional,
so the web service can start before credentials are configured.

Pi configuration can be stored in the persistent `/home/node/.pi` volume.
Configure model providers there, or use provider environment variables from
the Secret. Do not store credentials in Git or in the container image.

The workspace PVC starts empty. Populate it with the project files the agent
should access, and ensure the storage driver allows the container's UID/GID
`1000` to write to the mounted volumes.
