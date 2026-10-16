Smalltalk interchangeVersion: '1.0'!
Class named: 'False'
  superclass: 'Boolean'
  indexedInstanceVariables: #none
  instanceVariableNames: ''
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Kernel-Objects'!

False method!
& aBoolean ^false!
Annotation key: 'category' value: 'logical'!

False method!
| aBoolean ^aBoolean!
Annotation key: 'category' value: 'logical'!

False method!
and: block ^false!
Annotation key: 'category' value: 'control'!

False method!
ifFalse: block ^block value!
Annotation key: 'category' value: 'control'!

False method!
ifFalse: no ifTrue: yes ^no value!
Annotation key: 'category' value: 'control'!

False method!
ifTrue: block ^nil!
Annotation key: 'category' value: 'control'!

False method!
ifTrue: yes ifFalse: no ^no value!
Annotation key: 'category' value: 'control'!

False method!
not ^true!
Annotation key: 'category' value: 'control'!

False method!
or: block ^block value!
Annotation key: 'category' value: 'control'!

False method!
printOn: aStream aStream nextPutAll: 'false'!
Annotation key: 'category' value: 'printing'!
