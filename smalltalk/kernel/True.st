Smalltalk interchangeVersion: '1.0'!
Class named: 'True'
  superclass: 'Boolean'
  indexedInstanceVariables: #none
  instanceVariableNames: ''
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Kernel-Objects'!

True method!
& aBoolean ^aBoolean!
Annotation key: 'category' value: 'logical'!

True method!
| aBoolean ^true!
Annotation key: 'category' value: 'logical'!

True method!
and: block ^block value!
Annotation key: 'category' value: 'control'!

True method!
ifFalse: block ^nil!
Annotation key: 'category' value: 'control'!

True method!
ifFalse: no ifTrue: yes ^yes value!
Annotation key: 'category' value: 'control'!

True method!
ifTrue: block ^block value!
Annotation key: 'category' value: 'control'!

True method!
ifTrue: yes ifFalse: no ^yes value!
Annotation key: 'category' value: 'control'!

True method!
not ^false!
Annotation key: 'category' value: 'control'!

True method!
or: block ^true!
Annotation key: 'category' value: 'control'!

True method!
printOn: aStream aStream nextPutAll: 'true'!
Annotation key: 'category' value: 'printing'!
