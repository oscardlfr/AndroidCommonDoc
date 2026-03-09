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
