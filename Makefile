# Detect OS
UNAME := $(shell uname -s)
ifeq ($(UNAME),Darwin)
  SCRIPTS_DIR := scripts/sh
  EXT := .sh
  RUN := bash
else ifeq ($(UNAME),Linux)
  SCRIPTS_DIR := scripts/sh
  EXT := .sh
  RUN := bash
else
  SCRIPTS_DIR := scripts/ps1
  EXT := .ps1
  RUN := powershell -File
endif

test:
	$(RUN) $(SCRIPTS_DIR)/gradle-run$(EXT) --project-root $(PROJECT) --module $(MODULE) test

coverage:
	$(RUN) $(SCRIPTS_DIR)/run-parallel-coverage-suite$(EXT) --project-root $(PROJECT)

coverage-report:
	$(RUN) $(SCRIPTS_DIR)/run-parallel-coverage-suite$(EXT) --project-root $(PROJECT) --skip-tests

verify-kmp:
	$(RUN) $(SCRIPTS_DIR)/verify-kmp-packages$(EXT) --project-root $(PROJECT)

sync-versions:
	$(RUN) $(SCRIPTS_DIR)/check-version-sync$(EXT)

build-run:
	$(RUN) $(SCRIPTS_DIR)/build-run-app$(EXT) --project-root $(PROJECT)

sbom:
	$(RUN) $(SCRIPTS_DIR)/generate-sbom$(EXT) --project-root $(PROJECT)

install-skills:
	$(RUN) setup/install-claude-skills$(EXT)

# L0 self-bootstrap (H1): installs into THIS checkout (no --project-root -- this
# is not a $(PROJECT)-external-KMP-repo operation), safe on the standard uniform
# pattern because install-git-hooks.ps1 genuinely delegates to the bash installer.
install-git-hooks:
	$(RUN) $(SCRIPTS_DIR)/install-git-hooks$(EXT)

# NOTE: no scripts/ps1/verify-git-hooks.ps1 exists (BACKLOG.md:305 marks .ps1 hooks
# as a post-macOS-migration pruning candidate) -- this target hardcodes bash on
# every OS instead of the uniform $(RUN)/$(EXT) pattern. On Windows it requires
# Git Bash (bash on PATH), the same assumption install-git-hooks.ps1 already makes
# for its own delegation. There is no PowerShell path for this target.
verify-git-hooks:
	bash scripts/sh/verify-git-hooks.sh
