import { BlockCall, Pause, SmallObject, Transfer } from './objects.js';

export const exceptionClasses = [
  ['Exception', 'Object', ['messageText', 'tag']],
  ['Error', 'Exception', []],
  ['ZeroDivide', 'Error', ['dividend']],
  ['MessageNotUnderstood', 'Error', ['message', 'receiver']],
  ['Notification', 'Exception', []],
  ['Warning', 'Notification', []],
  ['ExceptionSet', 'Object', ['selectors']],
  ['Message', 'Object', ['selector', 'arguments']],
];

export const exceptionSource = {
  'Exception class': {
    signaling: ['signal ^self new signal', 'signal: signalerText ^self new signal: signalerText'],
    'exception selection': [
      'handles: exception ^exception isKindOf: self',
      ', anotherSelector ^ExceptionSet new privateSelectors: (Array with: self with: anotherSelector)',
    ],
  },
  Exception: {
    'exception description': [
      'description ^self messageText isNil ifTrue: [self class name] ifFalse: [self messageText]',
      'messageText ^messageText',
      'tag ^tag isNil ifTrue: [self messageText] ifFalse: [tag]',
      'isResumable ^true',
      'defaultAction ^self privateSuspend: self description',
    ],
    'exception building': ['messageText: signalerText messageText := signalerText', 'tag: anObject tag := anObject'],
    signaling: [
      'signal ^self privateSearchFrom: self privateSignal ifNone: [self defaultAction]',
      'signal: signalerText self messageText: signalerText. ^self signal',
    ],
    handling: [
      `isNested
    | frame |
    frame := self privateActiveHandler.
    [(frame := self privateHandlerAfter: frame) isNil] whileFalse: [
      ((self privateHandlerSelector: frame) handles: self) ifTrue: [^true]].
    ^false`,
      `outer
    self isResumable ifFalse: [^self pass].
    self privateMarkOuter.
    ^self privateSearchFrom: self privateActiveHandler ifNone: [self defaultAction]`,
      'pass ^self privateSearchFrom: self privateActiveHandler ifNone: [self privateResumeEvaluating: [self defaultAction]]',
      'resignalAs: replacementException ^self privateResumeEvaluating: [replacementException signal]',
      'resume ^self resume: nil',
      `resume: resumptionValue
    self isResumable ifFalse: [^Error signal: 'The exception is not resumable.'].
    ^self privateResume: resumptionValue`,
      'retry ^self privateRetry: nil',
      'retryUsing: alternativeBlock ^self privateRetry: alternativeBlock',
      'return ^self return: nil',
      'return: returnValue ^self privateReturn: returnValue',
    ],
    private: [`privateSearchFrom: frame ifNone: noHandlerBlock
    | current |
    current := frame.
    [(current := self privateHandlerAfter: current) isNil] whileFalse: [
      ((self privateHandlerSelector: current) handles: self) ifTrue: [^self privateEvaluateHandler: current]].
    ^noHandlerBlock value`],
    printing: [`printOn: aStream
    aStream nextPutAll: self class name.
    self messageText isNil ifFalse: [aStream nextPutAll: ': '; nextPutAll: self messageText]`],
  },
  Error: { 'exception description': ['isResumable ^false'] },
  'ZeroDivide class': { signaling: ['dividend: argument ^self new dividend: argument; signal'] },
  ZeroDivide: {
    accessing: ['dividend ^dividend', 'dividend: argument dividend := argument'],
    'exception description': ['isResumable ^true'],
  },
  MessageNotUnderstood: {
    accessing: ['message ^message', 'receiver ^receiver', 'message: aMessage receiver: anObject message := aMessage. receiver := anObject'],
    'exception description': [
      'isResumable ^true',
      `description
    ^self messageText isNil
      ifTrue: [receiver class name, ' does not understand ', message selector, '.']
      ifFalse: [self messageText]`,
    ],
  },
  Notification: { 'exception description': ['defaultAction ^nil', 'isResumable ^true'] },
  Warning: { 'exception description': ['defaultAction ^self privateWarn: self description'] },
  ExceptionSet: {
    'exception selection': [
      ', anotherSelector ^ExceptionSet new privateSelectors: (selectors copyWith: anotherSelector)',
      'handles: exception ^selectors anySatisfy: [:each | each handles: exception]',
    ],
    private: ['privateSelectors: anArray selectors := anArray'],
  },
  'Message class': { 'instance creation': ['selector: aSelector arguments: anArray ^self new setSelector: aSelector arguments: anArray'] },
  Message: {
    accessing: ['selector ^selector', 'arguments ^arguments'],
    private: ['setSelector: aSelector arguments: anArray selector := aSelector. arguments := anArray'],
    printing: ['printOn: aStream aStream nextPutAll: selector; nextPutAll: \' \'; print: arguments'],
  },
  Object: {
    'error handling': [
      'doesNotUnderstand: aMessage ^MessageNotUnderstood new message: aMessage receiver: self; signal',
      'error: signalerText ^Error new signal: signalerText',
    ],
  },
  Block: {
    'exception handling': [`ensure: terminationBlock
    | result |
    result := self ifCurtailed: terminationBlock.
    terminationBlock value.
    ^result`],
  },
};

export function installExceptionPrimitives(runtime) {
  const records = new WeakMap();
  const exceptionClass = runtime.classes.get('Exception');
  const isKind = (value, name) => {
    const target = runtime.classes.get(name);
    for (let klass = runtime.classOf(value); klass; klass = klass.superclass) if (klass === target) return true;
    return false;
  };
  const inChain = (process, frame) => {
    for (let current = process.frame; current; current = current.caller) if (current === frame) return true;
    return false;
  };
  const frameById = (process, id) => {
    for (let frame = process.frame; frame; frame = frame.caller) if (BigInt(frame.id) === id) return frame;
    throw new Error(`Frame ${id} is not active in this process.`);
  };
  const record = (exception, process) => {
    const entry = records.get(exception);
    if (!entry || entry.process !== process || !inChain(process, entry.signal)) throw new Error('The exception is not signaled in this process.');
    return entry;
  };
  const handler = entry => {
    if (!entry.active || !inChain(entry.process, entry.active)) throw new Error('The exception has no active handler.');
    return entry.active;
  };
  const blockClass = runtime.classes.get('Block');
  const block = (value, arity, message) => {
    if (runtime.classOf(value) !== blockClass || value.code.args.length !== arity) throw new Error(message);
    return value;
  };
  const evaluate = (entry, frame, exception) => {
    entry.active = frame;
    return new BlockCall(frame.handler.action, [exception], { handlerFor: frame, handlerEnvironment: frame.caller });
  };
  const machinery = frame => {
    if (frame.method.selector === '<entry>') return false;
    if (frame.failure) return true;
    for (let klass = frame.method.owner.instanceClass ?? frame.method.owner; klass; klass = klass.superclass) if (klass === exceptionClass) return true;
    return false;
  };
  const describe = (exception, text) => {
    const error = new Error(typeof text === 'string' ? text : exception.klass.name);
    error.name = exception.klass.name;
    if (isKind(exception, 'MessageNotUnderstood')) {
      const message = exception.slots.message instanceof SmallObject ? exception.slots.message.slots : {};
      Object.assign(error, { receiver: exception.slots.receiver, selector: message.selector?.name ?? message.selector,
        arguments: Array.isArray(message.arguments) ? [...message.arguments] : [] });
    }
    return error;
  };

  const define = (selector, arity, invoke) => runtime.primitive(exceptionClass, selector, arity, invoke, { protocol: 'private' });
  define('privateSignal', 0, (exception, _args, { process }) => {
    const frame = process.frame;
    records.set(exception, { process, signal: frame, active: null, outers: [] });
    return runtime.stopOnSignal ? new Pause({ reason: 'signal', exception }, BigInt(frame.id)) : BigInt(frame.id);
  });
  define('privateHandlerAfter:', 1, (_exception, [id], { process }) => {
    for (let frame = frameById(process, id).caller; frame;) {
      if (frame.handlerEnvironment) frame = frame.handlerEnvironment;
      else if (frame.handler) return BigInt(frame.id);
      else frame = frame.caller;
    }
    return null;
  });
  define('privateHandlerSelector:', 1, (_exception, [id], { process }) => {
    const frame = frameById(process, id);
    if (!frame.handler) throw new Error(`Frame ${id} has no exception handler.`);
    return frame.handler.selector;
  });
  define('privateEvaluateHandler:', 1, (exception, [id], { process }) => evaluate(record(exception, process), frameById(process, id), exception));
  define('privateMarkOuter', 0, (exception, _args, { process }) => {
    const entry = record(exception, process);
    entry.outers.push({ frame: process.frame, active: entry.active });
    return exception;
  });
  define('privateActiveHandler', 0, (exception, _args, { process }) => BigInt(handler(record(exception, process)).id));
  define('privateResume:', 1, (exception, [value], { process }) => {
    const entry = record(exception, process);
    while (entry.outers.length) {
      const target = entry.outers.pop();
      if (inChain(process, target.frame)) {
        entry.active = target.active;
        return new Transfer(target.frame, { value });
      }
    }
    return new Transfer(entry.signal, { value });
  });
  define('privateReturn:', 1, (exception, [value], { process }) => new Transfer(handler(record(exception, process)).caller, { value }));
  define('privateRetry:', 1, (exception, [alternative], { process }) => {
    const frame = handler(record(exception, process));
    const receiver = alternative === null ? frame.handler.block : block(alternative, 0, 'retryUsing: requires a block without arguments.');
    return new Transfer(frame.caller, { block: receiver,
      marks: { handler: { ...frame.handler, block: receiver }, sendPc: frame.sendPc, operands: frame.operands } });
  });
  define('privateResumeEvaluating:', 1, (exception, [action], { process }) =>
    new Transfer(record(exception, process).signal, { block: block(action, 0, 'Expected a block without arguments.'), marks: {} }));
  define('privateSuspend:', 1, (exception, [text], { process }) => {
    let top = record(exception, process).signal;
    while (top.caller && machinery(top.caller)) top = top.caller;
    const error = top.failure?.exception === exception ? top.failure.error : describe(exception, text);
    const restore = top.sendPc === undefined ? { pc: top.caller.pc, operands: [] } : { pc: top.sendPc, operands: top.operands };
    return new Transfer(top.caller, { restore, stop: { reason: 'error', error, exception } });
  });
  define('privateWarn:', 1, (exception, [text]) => new Pause({ reason: 'warning', message: typeof text === 'string' ? text : exception.klass.name, exception }, null));

  runtime.primitive(blockClass, 'on:do:', 2, (receiver, [selector, action]) => {
    block(receiver, 0, 'on:do: requires a block without arguments.');
    block(action, 1, 'on:do: requires a handler block with one argument.');
    return new BlockCall(receiver, [], { handler: { selector, action, block: receiver } });
  }, { protocol: 'exception handling' });
  runtime.primitive(blockClass, 'ifCurtailed:', 1, (receiver, [terminationBlock]) => {
    block(receiver, 0, 'ifCurtailed: requires a block without arguments.');
    return new BlockCall(receiver, [], { unwindBlock: block(terminationBlock, 0, 'ifCurtailed: requires a termination block without arguments.') });
  }, { protocol: 'exception handling' });
}
