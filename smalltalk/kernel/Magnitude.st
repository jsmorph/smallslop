Smalltalk interchangeVersion: '1.0'!
Class named: 'Magnitude'
  superclass: 'Object'
  indexedInstanceVariables: #none
  instanceVariableNames: ''
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Kernel-Magnitudes'!

Magnitude method!
< aMagnitude ^self subclassResponsibility!
Annotation key: 'category' value: 'comparing'!

Magnitude method!
<= aMagnitude ^(aMagnitude < self) not!
Annotation key: 'category' value: 'comparing'!

Magnitude method!
> aMagnitude ^aMagnitude < self!
Annotation key: 'category' value: 'comparing'!

Magnitude method!
>= aMagnitude ^(self < aMagnitude) not!
Annotation key: 'category' value: 'comparing'!

Magnitude method!
between: min and: max ^self >= min and: [self <= max]!
Annotation key: 'category' value: 'comparing'!

Magnitude method!
max: aMagnitude ^self > aMagnitude ifTrue: [self] ifFalse: [aMagnitude]!
Annotation key: 'category' value: 'comparing'!

Magnitude method!
min: aMagnitude ^self < aMagnitude ifTrue: [self] ifFalse: [aMagnitude]!
Annotation key: 'category' value: 'comparing'!
