Smalltalk interchangeVersion: '1.0'!
Class named: 'Exception'
  superclass: 'Object'
  indexedInstanceVariables: #none
  instanceVariableNames: 'messageText tag'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Kernel-Exceptions'!

Exception method!
defaultAction ^self privateSuspend: self description!
Annotation key: 'category' value: 'exception description'!

Exception method!
description ^self messageText isNil ifTrue: [self class name] ifFalse: [self messageText]!
Annotation key: 'category' value: 'exception description'!

Exception method!
isNested
    | frame |
    frame := self privateActiveHandler.
    [(frame := self privateHandlerAfter: frame) isNil] whileFalse: [
      ((self privateHandlerSelector: frame) handles: self) ifTrue: [^true]].
    ^false!
Annotation key: 'category' value: 'handling'!

Exception method!
isResumable ^true!
Annotation key: 'category' value: 'exception description'!

Exception method!
messageText ^messageText!
Annotation key: 'category' value: 'exception description'!

Exception method!
messageText: signalerText messageText := signalerText!
Annotation key: 'category' value: 'exception building'!

Exception method!
outer
    self isResumable ifFalse: [^self pass].
    self privateMarkOuter.
    ^self privateSearchFrom: self privateActiveHandler ifNone: [self defaultAction]!
Annotation key: 'category' value: 'handling'!

Exception method!
pass ^self privateSearchFrom: self privateActiveHandler ifNone: [self privateResumeEvaluating: [self defaultAction]]!
Annotation key: 'category' value: 'handling'!

Exception method!
printOn: aStream
    aStream nextPutAll: self class name.
    self messageText isNil ifFalse: [aStream nextPutAll: ': '; nextPutAll: self messageText]!
Annotation key: 'category' value: 'printing'!

Exception method!
privateSearchFrom: frame ifNone: noHandlerBlock
    | current |
    current := frame.
    [(current := self privateHandlerAfter: current) isNil] whileFalse: [
      ((self privateHandlerSelector: current) handles: self) ifTrue: [^self privateEvaluateHandler: current]].
    ^noHandlerBlock value!
Annotation key: 'category' value: 'private'!

Exception method!
resignalAs: replacementException ^self privateResumeEvaluating: [replacementException signal]!
Annotation key: 'category' value: 'handling'!

Exception method!
resume ^self resume: nil!
Annotation key: 'category' value: 'handling'!

Exception method!
resume: resumptionValue
    self isResumable ifFalse: [^Error signal: 'The exception is not resumable.'].
    ^self privateResume: resumptionValue!
Annotation key: 'category' value: 'handling'!

Exception method!
retry ^self privateRetry: nil!
Annotation key: 'category' value: 'handling'!

Exception method!
retryUsing: alternativeBlock ^self privateRetry: alternativeBlock!
Annotation key: 'category' value: 'handling'!

Exception method!
return ^self return: nil!
Annotation key: 'category' value: 'handling'!

Exception method!
return: returnValue ^self privateReturn: returnValue!
Annotation key: 'category' value: 'handling'!

Exception method!
signal ^self privateSearchFrom: self privateSignal ifNone: [self defaultAction]!
Annotation key: 'category' value: 'signaling'!

Exception method!
signal: signalerText self messageText: signalerText. ^self signal!
Annotation key: 'category' value: 'signaling'!

Exception method!
tag ^tag isNil ifTrue: [self messageText] ifFalse: [tag]!
Annotation key: 'category' value: 'exception description'!

Exception method!
tag: anObject tag := anObject!
Annotation key: 'category' value: 'exception building'!

Exception classMethod!
, anotherSelector ^ExceptionSet new privateSelectors: (Array with: self with: anotherSelector)!
Annotation key: 'category' value: 'exception selection'!

Exception classMethod!
handles: exception ^exception isKindOf: self!
Annotation key: 'category' value: 'exception selection'!

Exception classMethod!
signal ^self new signal!
Annotation key: 'category' value: 'signaling'!

Exception classMethod!
signal: signalerText ^self new signal: signalerText!
Annotation key: 'category' value: 'signaling'!
