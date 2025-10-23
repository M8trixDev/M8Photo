# Advanced Selections and Transforms Implementation

## Overview
This document describes the implementation of advanced selection tools and transform workflows for M8Photo Studio.

## Features Implemented

### 1. Selection Tools

#### Existing (`modules/tools/select.js`)
- Rectangular marquee selection with marching ants
- Add/subtract/intersect modes via modifiers
- Fill and clear operations

#### Enhancements Needed
The existing select tool will be enhanced to support additional modes:

1. **Ellipse Marquee Mode**
   - Circular/elliptical selections
   - Shift to constrain to circle
   - Alt/Option to draw from center

2. **Lasso Mode (Free-form)**  
   - Free-hand drawing of selection boundaries
   - Closes path automatically on mouse release
   - Supports feathering

3. **Polygonal Lasso Mode**
   - Click to add points
   - Double-click or Enter to complete
   - ESC to cancel

4. **Magic Wand Tool**
   - Color-based selection  
   - Tolerance setting (0-255)
   - Contiguous mode (flood fill vs global)
   - Sample from merged layers or active layer

### 2. Selection Operations

New operations added to the selection system:

1. **Invert** - Inverts the current selection
2. **Feather** - Applies gaussian blur to selection edges  
3. **Expand/Contract** - Grows or shrinks selection by N pixels
4. **Refine Edge** - Advanced edge detection and cleanup

### 3. Transform Tool

New dedicated transform tool (`modules/tools/transform.js`):

1. **Free Transform**
   - 8 resize handles (corners + sides)
   - Rotate handle  
   - Move by dragging center
   - Shift to constrain proportions
   - Alt/Option to transform from center
   - ESC to cancel
   - Enter to commit

2. **Transform Modes**
   - Scale (uniform or non-uniform)
   - Rotate (with angle snapping via Shift)
   - Flip horizontal/vertical  
   - Perspective (4-corner adjustment)
   - Warp (grid-based mesh transform)

3. **Transform Targets**
   - Active layer
   - Selection content
   - Multiple selected layers

### 4. UX Requirements

1. **Keyboard Modifiers**
   - Shift: Constrain proportions / add to selection
   - Alt/Option: From center / subtract from selection  
   - Ctrl/Cmd: Intersect with selection
   - ESC: Cancel operation
   - Enter: Commit/apply operation

2. **Visual Feedback**
   - Marching ants at 60fps using CSS animation
   - Transform handles with hover states
   - Live preview during operations
   - Bounds visualization

3. **History Integration**
   - All operations are undoable/redoable
   - Coalescing for interactive transforms
   - Proper command labeling

## Implementation Files

1. `modules/tools/select.js` - Enhanced with new selection modes
2. `modules/tools/selectionOps.js` - Selection operation commands
3. `modules/tools/transform.js` - New transform tool
4. `modules/tools/index.js` - Updated tool registration
5. `modules/core/store.js` - Extended selection state (mask support)
6. `scripts/palette.js` - Already has UI for marquee/lasso

## State Schema Extensions

```javascript
selection: {
  region: { x, y, width, height } | null,  // Rectangle (existing)
  mask: Canvas | null,                      // Pixel mask (new)
  maskId: string | null,                    // Asset ID (new)  
  mode: "replace" | "add" | "subtract" | "intersect",
  feather: number,
}
```

## Browser Compatibility  
- Chrome/Edge ✓
- Firefox ✓  
- Safari ✓
- Uses standard Canvas 2D API
- CSS animations for marching ants
- Pointer events for input

## Testing Checklist
- [x] Rectangular marquee works
- [ ] Ellipse marquee works with Shift/Alt
- [ ] Free lasso creates smooth selections  
- [ ] Polygonal lasso handles points correctly
- [ ] Magic wand respects tolerance
- [ ] Add/subtract/intersect modes work
- [ ] Invert selection works
- [ ] Feather applies correctly  
- [ ] Transform handles respond properly
- [ ] Shift constrains transforms
- [ ] ESC cancels operations
- [ ] Enter commits transforms
- [ ] Undo/redo works for all operations
- [ ] Marching ants render at 60fps
- [ ] No canvas flicker on apply

##Status

This is a design document. Implementation is in progress.
