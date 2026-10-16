Smalltalk interchangeVersion: '1.0'!
Class named: 'SystemBrowser'
  superclass: 'Pane'
  indexedInstanceVariables: #none
  instanceVariableNames: 'category className side protocol selector method draft baseline draftProtocol baselineProtocol creating defining message query results service'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Tools-Browser'!

SystemBrowser method!
accept
      service call: 'requireEditable'.
      defining ifTrue: [^self acceptDefinition].
      self loadMethod: (service call: 'install' with: draft with: draftProtocol with: method).
      protocol := draftProtocol. message := 'Installed'. self render!
Annotation key: 'category' value: 'editing'!

SystemBrowser method!
acceptDefinition
      | result |
      result := service call: 'define' with: draft.
      className := result get: 'className'. side := 'instance'. protocol := nil.
      category isNil ifFalse: [category := service call: 'categoryFor' with: className].
      self clearMethod. message := result get: 'message'. self render!
Annotation key: 'category' value: 'editing'!

SystemBrowser method!
browseClass: name method: selected
      self selectClass: name. side := 'instance'.
      selected isNil ifFalse: [self loadMethod: (service call: 'method' with: selected)].
      self render!
Annotation key: 'category' value: 'browsing'!

SystemBrowser method!
clearMethod
      selector := nil. method := nil. creating := false. message := ''.
      defining := className notNil.
      draft := defining ifTrue: [service call: 'definition'] ifFalse: [''].
      baseline := draft.
      draftProtocol := protocol isNil ifTrue: ['unclassified'] ifFalse: [protocol].
      baselineProtocol := draftProtocol!
Annotation key: 'category' value: 'selecting'!

SystemBrowser method!
clearResults query := nil. results := nil. self render!
Annotation key: 'category' value: 'browsing'!

SystemBrowser method!
editProtocol: name
      service call: 'requireEditable'. draftProtocol := service call: 'text' with: name. self render!
Annotation key: 'category' value: 'editing'!

SystemBrowser method!
editSource: text
      service call: 'requireEditable'. draft := service call: 'text' with: text. self render!
Annotation key: 'category' value: 'editing'!

SystemBrowser method!
fileIn: text
      | report |
      self requireClean. report := service call: 'fileIn' with: text.
      (className notNil and: [(service call: 'hasClass' with: className) not]) ifTrue: [className := nil].
      self clearMethod. message := report. self render!
Annotation key: 'category' value: 'editing'!

SystemBrowser method!
find: kind results := service call: 'find' with: kind. query := kind. self render!
Annotation key: 'category' value: 'browsing'!

SystemBrowser method!
hasChanges ^(draft ~= baseline) or: [draftProtocol ~= baselineProtocol]!
Annotation key: 'category' value: 'selecting'!

SystemBrowser method!
loadMethod: version
      method := version. selector := version get: 'selector'. creating := false. defining := false.
      draft := service call: 'source' with: version. baseline := draft.
      draftProtocol := version get: 'protocol'. baselineProtocol := draftProtocol.
      protocol isNil ifFalse: [protocol := draftProtocol].
      message := ''!
Annotation key: 'category' value: 'selecting'!

SystemBrowser method!
newClass
      self requireClean. self clearMethod.
      defining := true. draft := service call: 'classTemplate'. baseline := ''. self render!
Annotation key: 'category' value: 'editing'!

SystemBrowser method!
newMethod
      self requireClean. service call: 'owner'. self clearMethod.
      creating := true. defining := false. draft := 'newMethod
  ^self'. self render!
Annotation key: 'category' value: 'editing'!

SystemBrowser method!
requireClean ^service call: 'requireClean' with: self hasChanges!
Annotation key: 'category' value: 'selecting'!

SystemBrowser method!
revert
      selector isNil
        ifTrue: [self clearMethod]
        ifFalse: [self loadMethod: (service call: 'method' with: selector)].
      message := 'Reverted'. self render!
Annotation key: 'category' value: 'editing'!

SystemBrowser method!
selectCategory: name
      self requireClean. category := service call: 'category' with: name.
      className := nil. protocol := nil. self clearMethod. self render!
Annotation key: 'category' value: 'selecting'!

SystemBrowser method!
selectClass: name
      self requireClean. className := service call: 'className' with: name.
      category isNil ifFalse: [category := service call: 'categoryFor' with: name].
      protocol := nil. self clearMethod. self render!
Annotation key: 'category' value: 'selecting'!

SystemBrowser method!
selectMethod: name
      self requireClean. self loadMethod: (service call: 'method' with: name). self render!
Annotation key: 'category' value: 'selecting'!

SystemBrowser method!
selectProtocol: name
      self requireClean. protocol := service call: 'protocol' with: name.
      self clearMethod. self render!
Annotation key: 'category' value: 'selecting'!

SystemBrowser method!
selectSide: name
      self requireClean. side := service call: 'side' with: name.
      protocol := nil. self clearMethod. self render!
Annotation key: 'category' value: 'selecting'!

SystemBrowser method!
toggleBreakpoint message := service call: 'toggleBreakpoint' with: method. self render!
Annotation key: 'category' value: 'browsing'!
