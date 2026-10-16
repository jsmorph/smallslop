Smalltalk interchangeVersion: '1.0'!

Object method!
-> anObject ^Association key: self value: anObject!
Annotation key: 'category' value: 'associating'!

Object method!
= other ^self == other!
Annotation key: 'category' value: 'testing'!

Object method!
~= other ^(self = other) not!
Annotation key: 'category' value: 'testing'!

Object method!
~~ other ^(self == other) not!
Annotation key: 'category' value: 'testing'!

Object method!
doesNotUnderstand: aMessage ^MessageNotUnderstood new message: aMessage receiver: self; signal!
Annotation key: 'category' value: 'error handling'!

Object method!
error: signalerText ^Error new signal: signalerText!
Annotation key: 'category' value: 'error handling'!

Object method!
hash ^self identityHash!
Annotation key: 'category' value: 'comparing'!

Object method!
isArray ^false!
Annotation key: 'category' value: 'testing'!

Object method!
isCharacter ^false!
Annotation key: 'category' value: 'testing'!

Object method!
isCollection ^false!
Annotation key: 'category' value: 'testing'!

Object method!
isFloat ^false!
Annotation key: 'category' value: 'testing'!

Object method!
isFraction ^false!
Annotation key: 'category' value: 'testing'!

Object method!
isInteger ^false!
Annotation key: 'category' value: 'testing'!

Object method!
isNil ^false!
Annotation key: 'category' value: 'testing'!

Object method!
isNumber ^false!
Annotation key: 'category' value: 'testing'!

Object method!
isString ^false!
Annotation key: 'category' value: 'testing'!

Object method!
isSymbol ^false!
Annotation key: 'category' value: 'testing'!

Object method!
notNil ^true!
Annotation key: 'category' value: 'testing'!

Object method!
printOn: aStream
        | name |
        name := self class name.
        aStream nextPutAll: ((name at: 1) isVowel ifTrue: ['an '] ifFalse: ['a ']); nextPutAll: name!
Annotation key: 'category' value: 'printing'!

Object method!
printString
        | stream |
        stream := WriteStream on: String new.
        self printOn: stream.
        ^stream contents!
Annotation key: 'category' value: 'printing'!

Object method!
shouldNotImplement ^self error: 'This message is not appropriate for this object.'!
Annotation key: 'category' value: 'error handling'!

Object method!
subclassResponsibility ^self error: 'A subclass must implement this message.'!
Annotation key: 'category' value: 'error handling'!
