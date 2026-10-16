Smalltalk interchangeVersion: '1.0'!
Class named: 'WriteStream'
  superclass: 'Stream'
  indexedInstanceVariables: #none
  instanceVariableNames: 'buffer kind'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Collections-Streams'!

WriteStream method!
close ^self!
Annotation key: 'category' value: 'accessing'!

WriteStream method!
cr self nextPut: Character lf!
Annotation key: 'category' value: 'accessing'!

WriteStream method!
flush ^self!
Annotation key: 'category' value: 'accessing'!

WriteStream method!
isEmpty ^self contents isEmpty!
Annotation key: 'category' value: 'accessing'!

WriteStream method!
position ^self contents size!
Annotation key: 'category' value: 'accessing'!

WriteStream method!
print: anObject anObject printOn: self!
Annotation key: 'category' value: 'accessing'!

WriteStream method!
setToEnd ^self!
Annotation key: 'category' value: 'accessing'!

WriteStream method!
space self nextPut: Character space!
Annotation key: 'category' value: 'accessing'!

WriteStream method!
tab self nextPut: Character tab!
Annotation key: 'category' value: 'accessing'!

WriteStream classMethod!
on: aCollection ^self basicNew initializeOn: aCollection!
Annotation key: 'category' value: 'instance creation'!

WriteStream classMethod!
with: aCollection ^self basicNew initializeWith: aCollection!
Annotation key: 'category' value: 'instance creation'!
