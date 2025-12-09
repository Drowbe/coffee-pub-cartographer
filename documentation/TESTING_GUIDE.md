# Cartographer Testing Guide

## Phase 1 Testing

### Prerequisites

1. **FoundryVTT v13** installed and running
2. **Coffee Pub Blacksmith** module installed and enabled
3. **Coffee Pub Cartographer** module in your `Data/modules/` folder

### Step 1: Load the Module

1. Open FoundryVTT
2. Create or load a world
3. Go to **Configure Settings** → **Manage Modules**
4. Enable **Coffee Pub Cartographer**
5. Press **F5** to reload the application

### Step 2: Check Console for Initialization

Open the browser console (F12 → Console tab) and look for:

**Expected Success Messages:**
```
✅ CARTOGRAPHER: Registered with Blacksmith successfully
CARTOGRAPHER: Module initialized
✅ CARTOGRAPHER: Canvas Layer initialized
✅ CARTOGRAPHER: Drawing Tool initialized
```

**If you see warnings:**
```
⚠️ CARTOGRAPHER: Blacksmith not available
```
→ **Issue**: Blacksmith module is not enabled. Enable it and reload.

```
⚠️ CARTOGRAPHER: Canvas Layer not available
```
→ **Issue**: Canvas hasn't loaded yet. Wait a moment or switch to a scene.

### Step 3: Verify Settings

1. Go to **Configure Settings** → **Coffee Pub Cartographer**
2. You should see:
   - **Getting Started** section (with Introduction)
   - **Common Settings** section
   - **Drawing Tool Settings** subsection with:
     - ✅ **Enable Player Drawing** (checkbox, default: checked)
     - ✅ **Drawing Timeout (seconds)** (number input, default: 3600)
     - ✅ **Allow Drawing Persistence** (checkbox, default: checked)

### Step 4: Test Canvas Layer Access

In the browser console, run:

```javascript
// Check if Canvas Layer is available
const layer = await BlacksmithAPI.getCanvasLayer();
console.log('Canvas Layer:', layer);
```

**Expected**: Should return the Canvas Layer object (not null)

**Alternative check:**
```javascript
// Check via direct access
console.log('Canvas Layer (direct):', canvas['blacksmith-utilities-layer']);
```

### Step 5: Verify Tool Registration

In the browser console, run:

```javascript
// Check if drawing tool is accessible (use full module path)
import('/modules/coffee-pub-cartographer/scripts/manager-drawing.js').then(module => {
    console.log('Drawing Tool:', module.drawingTool);
    console.log('Tool Name:', module.drawingTool.name);
    console.log('Tool Active:', module.drawingTool.isActive());
});
```

**Expected**: Should show the drawing tool object with `name: 'drawing'` and `isActive(): false`

**Alternative (if import doesn't work):**
```javascript
// Access via game.modules API
const module = game.modules.get('coffee-pub-cartographer');
console.log('Module:', module);
// Note: Tools are not directly exposed via game.modules, use import method above
```

### Step 6: Test Shared Services

In the browser console, run:

```javascript
// Check CartographerServices (use full module path)
import('/modules/coffee-pub-cartographer/scripts/cartographer.js').then(module => {
    console.log('Services:', module.CartographerServices);
    console.log('Canvas Layer:', module.CartographerServices.canvasLayer);
    console.log('Blacksmith API:', module.CartographerServices.blacksmithAPI);
    console.log('MODULE:', module.CartographerServices.MODULE);
});
```

**Expected**: 
- `canvasLayer` should be the Canvas Layer object (after canvas is ready)
- `blacksmithAPI` should be the Blacksmith API object
- `MODULE` should be the module constants object

---

## Common Issues & Solutions

### Issue: Module Not Loading

**Symptoms:**
- Module doesn't appear in module list
- Console shows module loading errors

**Solutions:**
1. Check `module.json` for syntax errors (validate JSON)
2. Verify folder name matches module ID: `coffee-pub-cartographer`
3. Check that all files in `esmodules` array exist
4. Look for JavaScript errors in console

### Issue: Blacksmith Not Available

**Symptoms:**
```
⚠️ CARTOGRAPHER: Blacksmith not available
```

**Solutions:**
1. Ensure **Coffee Pub Blacksmith** is installed
2. Enable **Coffee Pub Blacksmith** in module settings
3. Reload FoundryVTT (F5)
4. Check that Blacksmith loads before Cartographer (check module load order)

### Issue: Canvas Layer Not Available

**Symptoms:**
```
⚠️ CARTOGRAPHER: Canvas Layer not available
```

**Solutions:**
1. Wait for canvas to load (switch to a scene)
2. Check that Blacksmith is enabled and working
3. Verify you're using FoundryVTT v13
4. Check console for Blacksmith errors

### Issue: Settings Not Appearing

**Symptoms:**
- Settings don't show in Configure Settings

**Solutions:**
1. Ensure `registerSettings()` is called (check console for "Settings registered" message)
2. Reload FoundryVTT (F5) - settings require reload after registration
3. Check `lang/en.json` for proper JSON syntax
4. Verify localization keys match in `settings.js` and `lang/en.json`

### Issue: Drawing Tool Not Initializing

**Symptoms:**
- No "Drawing Tool initialized" message in console

**Solutions:**
1. Check that Canvas Layer initialized first
2. Look for errors in console during tool initialization
3. Verify `manager-drawing.js` is in `module.json` esmodules array
4. Check that `drawingTool` is properly exported

---

## Quick Test Checklist

After loading the module, verify:

- [ ] Module appears in module list
- [ ] Module can be enabled
- [ ] No console errors on load
- [ ] "Registered with Blacksmith successfully" message appears
- [ ] "Module initialized" message appears
- [ ] "Canvas Layer initialized" message appears (after canvas loads)
- [ ] "Drawing Tool initialized" message appears
- [ ] Settings appear in Configure Settings
- [ ] All three drawing settings are visible
- [ ] Canvas Layer is accessible via console commands
- [ ] Drawing tool object is accessible via console commands
- [ ] Shared services are accessible via console commands

---

## Advanced Testing

### Test Settings Access

```javascript
// Test reading settings
const enableDrawing = game.settings.get('coffee-pub-cartographer', 'drawing.enablePlayerDrawing');
console.log('Enable Player Drawing:', enableDrawing);

const timeout = game.settings.get('coffee-pub-cartographer', 'drawing.timeout');
console.log('Drawing Timeout:', timeout);

const persistence = game.settings.get('coffee-pub-cartographer', 'drawing.allowPersistence');
console.log('Allow Persistence:', persistence);
```

### Test Tool State

```javascript
// Test tool activation (use full module path)
import('/modules/coffee-pub-cartographer/scripts/manager-drawing.js').then(module => {
    const tool = module.drawingTool;
    console.log('Before activation:', tool.isActive());
    tool.activate();
    console.log('After activation:', tool.isActive());
    tool.deactivate();
    console.log('After deactivation:', tool.isActive());
});
```

### Test Blacksmith Integration

```javascript
// Test Blacksmith APIs are available
console.log('HookManager:', typeof BlacksmithHookManager);
console.log('Utils:', typeof BlacksmithUtils);
console.log('ModuleManager:', typeof BlacksmithModuleManager);
console.log('Constants:', typeof BlacksmithConstants);
```

---

## What to Report

If you encounter issues, report:

1. **FoundryVTT Version**: (e.g., v13.0.0)
2. **Blacksmith Version**: Check in module list
3. **Console Errors**: Copy any error messages
4. **Console Logs**: Copy relevant log messages
5. **Steps to Reproduce**: What you did before the issue
6. **Expected vs Actual**: What you expected vs what happened

---

## Next Phase Testing

Once Phase 1 is verified working, Phase 2 testing will include:
- Testing drawing creation
- Testing canvas interactions
- Testing drawing flags
- Testing cleanup functions

---

**Last Updated**: Phase 1 Testing Guide  
**Status**: Ready for testing

