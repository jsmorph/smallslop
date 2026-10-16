Smalltalk interchangeVersion: '1.0'!
Class named: 'Pane'
  superclass: 'Object'
  indexedInstanceVariables: #none
  instanceVariableNames: 'id title owner x y width height visible enlarged savedBounds view'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Workspace'!

Pane method!
bounds: left top: top width: horizontal height: vertical
    | rectangle |
    rectangle := view call: 'bounds' with: left with: top with: horizontal with: vertical.
    x := rectangle get: 'x'. y := rectangle get: 'y'.
    width := rectangle get: 'width'. height := rectangle get: 'height'.
    self render!
Annotation key: 'category' value: 'window controls'!

Pane method!
close visible := false. self render!
Annotation key: 'category' value: 'window controls'!

Pane method!
enlarge
    enlarged ifTrue: [
      enlarged := false.
      self bounds: (savedBounds get: 'x') top: (savedBounds get: 'y')
        width: (savedBounds get: 'width') height: (savedBounds get: 'height')
    ] ifFalse: [
      savedBounds := view call: 'rectangle'. enlarged := true.
      self fit
    ]. self focus!
Annotation key: 'category' value: 'window controls'!

Pane method!
fit self bounds: 0.0 top: 0.0 width: (view call: 'width') height: (view call: 'height')!
Annotation key: 'category' value: 'window controls'!

Pane method!
focus ^view call: 'focus'!
Annotation key: 'category' value: 'window controls'!

Pane method!
moveTo: left y: top
    self bounds: left top: top width: width height: height.
    enlarged := false. self render!
Annotation key: 'category' value: 'window controls'!

Pane method!
open visible := true. self render. self focus!
Annotation key: 'category' value: 'window controls'!

Pane method!
render ^view call: 'render'!
Annotation key: 'category' value: 'window controls'!

Pane method!
resizeTo: horizontal height: vertical
    self bounds: x top: y width: horizontal height: vertical.
    enlarged := false. self render!
Annotation key: 'category' value: 'window controls'!
