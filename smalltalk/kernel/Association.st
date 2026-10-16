Smalltalk interchangeVersion: '1.0'!
Class named: 'Association'
  superclass: 'Object'
  indexedInstanceVariables: #none
  instanceVariableNames: 'key value'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Collections-Support'!

Association method!
= anObject ^(anObject isKindOf: Association) and: [key = anObject key and: [value = anObject value]]!
Annotation key: 'category' value: 'comparing'!

Association method!
hash ^key hash bitXor: value hash!
Annotation key: 'category' value: 'comparing'!

Association method!
key ^key!
Annotation key: 'category' value: 'accessing'!

Association method!
key: anObject key := anObject!
Annotation key: 'category' value: 'accessing'!

Association method!
key: aKey value: aValue key := aKey. value := aValue!
Annotation key: 'category' value: 'accessing'!

Association method!
printOn: aStream key printOn: aStream. aStream nextPutAll: '->'. value printOn: aStream!
Annotation key: 'category' value: 'printing'!

Association method!
value ^value!
Annotation key: 'category' value: 'accessing'!

Association method!
value: anObject value := anObject!
Annotation key: 'category' value: 'accessing'!

Association classMethod!
key: aKey value: aValue ^self basicNew key: aKey value: aValue!
Annotation key: 'category' value: 'instance creation'!
