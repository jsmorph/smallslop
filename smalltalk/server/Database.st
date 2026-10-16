Smalltalk interchangeVersion: '1.0'!
Class named: 'Database'
  superclass: 'Object'
  indexedInstanceVariables: #none
  instanceVariableNames: 'service'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Server-Data'!

Database method!
close ^service call: 'close'!
Annotation key: 'category' value: 'operations'!

Database method!
execute: sql ^self execute: sql parameters: (service call: 'emptyParameters')!
Annotation key: 'category' value: 'operations'!

Database method!
execute: sql parameters: bindings
      | data result |
      data := service call: 'execute' with: sql with: bindings.
      result := ResultSet new.
      ^result initialize: data!
Annotation key: 'category' value: 'operations'!

Database method!
schema ^service call: 'schema'!
Annotation key: 'category' value: 'operations'!
