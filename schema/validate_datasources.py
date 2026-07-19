#!/usr/bin/env python3
import os
import sys
import json
import glob

# Check for required dependencies
try:
    import yaml
except ImportError:
    print("Error: 'pyyaml' is required. Please install it using 'pip install pyyaml'.", file=sys.stderr)
    sys.exit(1)

try:
    from jsonschema import Draft7Validator
except ImportError:
    print("Error: 'jsonschema' is required. Please install it using 'pip install jsonschema'.", file=sys.stderr)
    sys.exit(1)

def main():
    schema_path = os.path.join(os.path.dirname(__file__), 'datasource-schema.json')
    if not os.path.exists(schema_path):
        print(f"Error: Schema file not found at {schema_path}", file=sys.stderr)
        sys.exit(1)

    try:
        with open(schema_path, 'r', encoding='utf-8') as f:
            schema = json.load(f)
    except Exception as e:
        print(f"Error: Failed to load schema JSON: {e}", file=sys.stderr)
        sys.exit(1)

    # Verify that the schema itself is valid
    try:
        Draft7Validator.check_schema(schema)
    except Exception as e:
        print(f"Error: Invalid JSON Schema: {e}", file=sys.stderr)
        sys.exit(1)

    validator = Draft7Validator(schema)

    # Search for all datasources.yaml under countries/ directory
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    yaml_pattern = os.path.join(base_dir, 'countries', '**', 'datasources.yaml')
    yaml_files = glob.glob(yaml_pattern, recursive=True)

    if not yaml_files:
        print("Warning: No 'datasources.yaml' files found in the 'countries' directory.")
        sys.exit(0)

    success = True
    print(f"Found {len(yaml_files)} datasources file(s) to validate.\n")

    for file_path in yaml_files:
        relative_path = os.path.relpath(file_path, base_dir)
        print(f"Validating {relative_path}...")
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = yaml.safe_load(f)
        except Exception as e:
            print(f"  [ERROR] Failed to parse YAML file: {e}")
            success = False
            continue

        if data is None:
            print("  [ERROR] File is empty.")
            success = False
            continue

        errors = list(validator.iter_errors(data))
        if errors:
            success = False
            print(f"  [ERROR] Validation failed for {relative_path}:")
            for error in sorted(errors, key=lambda e: e.path):
                path = " -> ".join([str(p) for p in error.path]) if error.path else "root"
                print(f"    - [{path}]: {error.message}")
        else:
            print(f"  [OK] {relative_path} is valid.")

    if not success:
        print("\nValidation FAILED.")
        sys.exit(1)
    else:
        print("\nAll files validated successfully.")
        sys.exit(0)

if __name__ == '__main__':
    main()
