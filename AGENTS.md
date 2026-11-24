## Conventional commits

In this project, we follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification for commit messages. This means that each commit message should have a specific format that indicates the type of change being made.
We use the following types of commit messages:
- `feat`: A new feature is being added to the project.
- `fix`: A bug fix is being made to the project.
- `docs`: Documentation changes are being made.
- `style`: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc).
- `refactor`: A code change that neither fixes a bug nor adds a feature.
- `perf`: A code change that improves performance.

## Ingress

We are using `traefik` as our kubernetes ingress.