Smalltalk interchangeVersion: '1.0'!
Class named: 'IdentityDictionary'
  superclass: 'Dictionary'
  indexedInstanceVariables: #none
  instanceVariableNames: ''
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Collections-Unordered'!

IdentityDictionary method!
hashOf: aKey ^aKey identityHash!
Annotation key: 'category' value: 'private'!

IdentityDictionary method!
is: a sameAs: b ^a == b!
Annotation key: 'category' value: 'private'!
