# Troubleshooting Cognee Memory Plugin

## Common Issues

### 1. UI Dashboard Not Responding

**Symptoms:** Messages don't return, UI hangs, or agent doesn't respond.

**Causes:**

- Cognee import failing (dependency issues)
- Python bridge script errors
- Timeout issues

**Solutions:**

1. **Check if plugin is enabled:**

   ```bash
   # Check your config
   cat ~/.openclaw/openclaw.json | grep -A 5 "memory-cognee"
   ```

2. **Temporarily disable the plugin:**

   ```json
   {
     "plugins": {
       "slots": {
         "memory": "memory-core"
       },
       "entries": {
         "memory-cognee": {
           "enabled": false
         }
       }
     }
   }
   ```

3. **Test Python bridge directly:**

   ```bash
   export LLM_API_KEY="your-key"
   python3 extensions/memory-cognee/bridge.py search "test" 5
   ```

4. **Check for Cognee import errors:**
   ```bash
   python3 -c "import cognee" 2>&1
   ```

### 2. Cognee Dependency Error

**Error:** `AttributeError: module 'starlette.status' has no attribute 'HTTP_422_UNPROCESSABLE_CONTENT'`

**Solution:**

```bash
pip install --upgrade starlette fastapi
# Or specific versions:
pip install starlette>=0.37.0 fastapi>=0.104.0
```

### 3. Python Not Found

**Error:** `ENOENT: python3 not found`

**Solution:**

- Ensure Python 3.10+ is installed
- Add to PATH if needed
- Use full path: `/usr/bin/python3` or `/usr/local/bin/python3`

### 4. Bridge Script Errors

**Error:** Bridge returns errors but plugin still tries to use it

**Solution:**

- The plugin now has better error handling and will return error messages instead of crashing
- Check the error message for specific issues
- Verify LLM_API_KEY is set correctly

### 5. Memory Tools Not Available

**Symptoms:** `memory_recall`, `memory_store`, `memory_forget` tools not showing up

**Causes:**

- Plugin not enabled
- Plugin not in memory slot
- Tool allowlist blocking tools

**Solutions:**

1. **Check plugin is in memory slot:**

   ```json
   {
     "plugins": {
       "slots": {
         "memory": "memory-cognee"
       }
     }
   }
   ```

2. **Check tool allowlist** (if using one):
   ```json
   {
     "agents": {
       "list": [
         {
           "id": "main",
           "tools": {
             "allow": ["memory_recall", "memory_store", "memory_forget"]
           }
         }
       ]
     }
   }
   ```

## Debugging Steps

1. **Check plugin registration:**
   - Look for log message: `memory-cognee: plugin registered`
   - Check for errors during plugin load

2. **Test bridge script manually:**

   ```bash
   export LLM_API_KEY="test"
   export COGNEE_DATA_DIR="/tmp/test-cognee"
   python3 extensions/memory-cognee/bridge.py add "test memory"
   python3 extensions/memory-cognee/bridge.py search "test" 5
   ```

3. **Check OpenClaw logs:**
   - Look for `memory-cognee:` prefixed log messages
   - Check for Python subprocess errors

4. **Verify Cognee installation:**
   ```bash
   pip list | grep cognee
   python3 -c "import cognee; print(cognee.__version__)"
   ```

## Fallback Options

If Cognee continues to cause issues, you can:

1. **Use memory-core instead:**

   ```json
   {
     "plugins": {
       "slots": {
         "memory": "memory-core"
       }
     }
   }
   ```

2. **Use memory-lancedb:**

   ```json
   {
     "plugins": {
       "slots": {
         "memory": "memory-lancedb"
       }
     }
   }
   ```

3. **Disable memory plugins entirely:**
   ```json
   {
     "plugins": {
       "slots": {
         "memory": "none"
       }
     }
   }
   ```
