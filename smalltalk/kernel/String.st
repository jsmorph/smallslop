Smalltalk interchangeVersion: '1.0'!
Class named: 'String'
  superclass: 'ArrayedCollection'
  indexedInstanceVariables: #none
  instanceVariableNames: ''
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Collections-Text'!

String method!
isString ^true!
Annotation key: 'category' value: 'testing'!

String method!
printOn: aStream aStream nextPutAll: self printString!
Annotation key: 'category' value: 'printing'!

String method!
species ^String!
Annotation key: 'category' value: 'copying'!

String method!
subStrings ^self subStrings: (String with: Character space with: Character tab with: Character cr with: Character lf)!
Annotation key: 'category' value: 'converting'!

String classMethod!
with: a ^self withAll: (Array with: a)!
Annotation key: 'category' value: 'instance creation'!

String classMethod!
with: a with: b ^self withAll: (Array with: a with: b)!
Annotation key: 'category' value: 'instance creation'!

String classMethod!
with: a with: b with: c ^self withAll: (Array with: a with: b with: c)!
Annotation key: 'category' value: 'instance creation'!

String classMethod!
with: a with: b with: c with: d ^self withAll: (Array with: a with: b with: c with: d)!
Annotation key: 'category' value: 'instance creation'!

String classMethod!
withAll: aCollection
        | stream |
        stream := WriteStream on: String new.
        aCollection do: [:each | stream nextPut: each].
        ^stream contents!
Annotation key: 'category' value: 'instance creation'!
