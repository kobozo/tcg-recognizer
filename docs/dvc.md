# Data & pipeline versioning (DVC)

Sub-project 4 brings the recognition model under **DVC** (Data Version Control)
for **MLOps maturity level 1**, mirroring the instructor's
`mlops-course-03` module (DVC data versioning + Docker containerization). DVC
versions the large card-image dataset (~3.2 GB, ~20k PNGs) outside git, records a
small pointer file in git, and turns training into a reproducible pipeline whose
metrics are tracked alongside the code.

## Why a wrapper (no host dvc / pip)

This host has **no usable pip** and **no host-level dvc**, so DVC is baked into
the **trainer image** (`services/trainer/requirements.txt`: `dvc==3.*`, core only
— a local-filesystem remote, no cloud extras). All `dvc` commands run inside a
one-off trainer container via **`scripts/dvc.sh`**, which bind-mounts the host
repo (including `.git`) at `/repo` so every artefact DVC writes (`.dvc/`,
`dvc.lock`, `*.dvc`, `.gitignore` edits) lands in the host repo. `git` is
installed in the image for DVC's SCM integration.

```bash
bash scripts/dvc.sh <any dvc subcommand>
```

## Key paths & decisions

| Thing                 | Location                          | In git?                |
|-----------------------|-----------------------------------|------------------------|
| Dataset (data blobs)  | `ml/datasets/pokemon/`            | No (DVC-tracked)       |
| DVC pointer           | `ml/datasets/pokemon.dvc`         | **Yes** (committed)    |
| Local DVC remote      | `./.dvc-remote/`                  | No (git-ignored)       |
| Pipeline params       | `params.yaml`                     | Yes                    |
| Pipeline definition   | `dvc.yaml`                        | Yes                    |
| Pipeline lock         | `dvc.lock`                        | Yes (after `repro`)    |
| Metrics               | `ml/metrics.json`                 | **Yes** (small JSON)   |

- **Remote**: a local-filesystem remote at `./.dvc-remote` (host dir, git-ignored)
  — no cloud account needed; team members on this host share one data version.
- **Metrics**: the trainer mounts `./ml` at `/mlout`; `main.py` writes
  `${METRICS_PATH:-/mlout/metrics.json}` → host-visible `ml/metrics.json`. The
  write is default-safe (skipped when the dir is absent) so a plain
  `docker compose run trainer`, `python main.py`, and CI are unaffected.

## One-time setup

```bash
# 1. Initialise DVC in the (host) git repo
bash scripts/dvc.sh init

# 2. Configure the local-filesystem remote (path resolves both in/out of the
#    container because scripts/dvc.sh mounts the repo at /repo)
bash scripts/dvc.sh remote add -d local /repo/.dvc-remote

# 3. Track the dataset. Writes ml/datasets/pokemon.dvc (committed) and a
#    DVC-managed ml/datasets/.gitignore entry for /pokemon (data stays out of git)
bash scripts/dvc.sh add ml/datasets/pokemon

# 4. Commit the pointers + config, then push the data to the local remote
git add .dvc .dvcignore dvc.yaml params.yaml \
        ml/datasets/pokemon.dvc ml/datasets/.gitignore
git commit -m "dvc: track pokemon dataset + pipeline"
bash scripts/dvc.sh push
git tag -a data-v1 -m "initial pokemon dataset"
```

## Reproduce the pipeline

`dvc.yaml` defines a `train` stage (and an optional `download` stage). The `train`
stage's `cmd` is `scripts/dvc-train.sh`, which reads `params.yaml` and runs the
dockerised trainer with the matching env overrides, then the trainer writes
`ml/metrics.json`.

```bash
# Edit params.yaml first — e.g. sample_size: 300 for a fast end-to-end test,
# or "all" for a full ~20k-card training.
bash scripts/dvc.sh repro            # runs the train stage if deps/params changed
bash scripts/dvc.sh metrics show     # show recall@1/@5/@10 etc. from ml/metrics.json
git add dvc.lock ml/metrics.json && git commit -m "train: refresh model + metrics"
```

> Note: `dvc repro` shells out to `docker compose run trainer`, which needs the
> Docker socket. If running `repro` from inside the dvc container is awkward in
> your setup, run the stage script directly on the host (`bash scripts/dvc-train.sh`)
> and then `bash scripts/dvc.sh commit` to update `dvc.lock`.

## Updating the dataset version

```bash
# after the dataset changes on disk (e.g. re-download with scripts/dvc-download.sh)
bash scripts/dvc.sh status
bash scripts/dvc.sh add ml/datasets/pokemon
git add ml/datasets/pokemon.dvc && git commit -m "dvc: update dataset"
git tag -a data-v2 -m "<what changed>"
bash scripts/dvc.sh push
```

## Restoring data on a fresh checkout

```bash
git pull                  # gets the pointer files + dvc.yaml
bash scripts/dvc.sh pull  # materialises ml/datasets/pokemon from the local remote
```

This ties directly to `mlops-course-03`: `dvc init` → `dvc remote add -d` →
`dvc add` → `dvc push`/`dvc pull` → pipeline stages with params & metrics, all
containerised so the workflow is reproducible without a host Python toolchain.
