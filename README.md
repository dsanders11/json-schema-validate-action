# JSON Schema Validate Action

[![GitHub Super-Linter](https://github.com/dsanders11/json-schema-validate-action/actions/workflows/linter.yml/badge.svg)](https://github.com/super-linter/super-linter)
[![CI](https://github.com/dsanders11/json-schema-validate-action/actions/workflows/ci.yml/badge.svg)](https://github.com/dsanders11/json-schema-validate-action/actions/workflows/ci.yml)

> GitHub Action which validates YAML/JSON files against a JSON schema

## Usage

### Example

```yaml
jobs:
  validate-github-actions-workflows:
    name: Validate GitHub Actions workflows
    permissions:
      contents: read
    runs-on: ubuntu-latest
    steps:
      - name: Check for any changed workflows
        id: check-for-changed-workflows
        run: |
          CHANGED_WORKFLOWS=$(gh api repos/${{ github.event.pull_request.base.repo.full_name }}/pulls/${{ github.event.pull_request.number }}/files --jq '.[] | select((.filename | match("^.github/workflows/.*.yml$")) and (.status != "removed")) | .filename')
          if [[ -n "$CHANGED_WORKFLOWS" ]]; then
            echo "any_changed=true" >> $GITHUB_OUTPUT
          else
            echo "any_changed=false" >> $GITHUB_OUTPUT
          fi
      - name: Validate workflows
        if: steps.check-for-changed-workflows.outputs.any_changed == 'true'
        uses: dsanders11/json-schema-validate-action@v1.4.0
        with:
          schema: https://json.schemastore.org/github-workflow.json
          files: .github/workflows/**.yml
```

### Example with Custom Error Messages

When `custom-errors` is enabled, you can use the `errorMessage` keyword in your
JSON schema to provide more user-friendly error messages. This is powered by the
[ajv-errors](https://github.com/ajv-validator/ajv-errors) library.

```yaml
jobs:
  validate-config:
    name: Validate configuration files
    runs-on: ubuntu-latest
    steps:
      - name: Validate config with custom errors
        uses: dsanders11/json-schema-validate-action@v1.4.0
        with:
          schema: ./config.schema.json
          files: ./config/*.yml
          custom-errors: true
```

Example schema with custom error messages:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "minLength": 1
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$"
    }
  },
  "required": ["name", "version"],
  "errorMessage": {
    "type": "Configuration must be an object",
    "required": {
      "name": "Configuration must have a 'name' property",
      "version": "Configuration must have a 'version' property"
    },
    "properties": {
      "name": "Name must be a non-empty string",
      "version": "Version must follow semantic versioning (e.g., '1.0.0')"
    }
  }
}
```

### Validating Schema

Schemas can be validated by setting the `schema` input to the string literal
`json-schema`.

### Remote Schema Cache Busting

By default the action will cache remote schemas (this can be disabled via the
`cache-remote-schema` input). If you need to bust this cache for any reason,
simply set a URL fragment (e.g. `#bust-cache`) on the schema URL.

### Inputs

- `schema` - **(required)** URL or file path to JSON schema to validate against
- `files` - **(required)** Multiline input of file paths to validate - supports
  globs
- `fail-on-invalid` - Whether or not to set action failure if a file is invalid
  (default: `true`)
- `cache-remote-schema` - Whether or not to cache the schema if remote (default:
  `true`)
- `all-errors` - Whether to report all errors or stop after the first (default:
  `false`)
- `custom-errors` - Enable support for custom error messages using ajv-errors
  (default: `false`)

### Outputs

- `valid` - `true` if all files are valid, otherwise `false`

## License

MIT
