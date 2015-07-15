#metaimport
  masakari
  hash-require

#require
  mori (queue, conj, peek, pop, count, seq, first, next, empty?, map, some)
  knuth-shuffle

;; A channel from which values can be taken.
#defprotocol TakeChan
  try-take! (c, k)   ;; Chan -> (Object -> ()) -> Bool
  take!     (c, k)   ;; Chan -> (Object -> ())

;; A channel on which values can be put.
#defprotocol PutChan
  try-put! (c, v, k) ;; Chan -> Object -> (() -> ()) -> Bool
  put!     (c, v, k) ;; Chan -> Object -> (Bool -> ())

;; A channel that can be closed explicitly.
#defprotocol CloseChan
  close! (c)

#defprotocol Buffer
  push! (b, v) ;; Buffer -> Object -> Bool
  pop!  (b)    ;; Buffer -> Maybe Object

fun mask action ->
  try
    action ()
  catch var e do
    console.warn ('ASYNC ERROR:', e.stack)
    undefined

fun noop () -> ()

;; A channel that connects multiple readers and writers.
fun ManyToManyChan buffer ->
  #doto this
    .buffer  = buffer
    .putting = queue ()
    .taking  = queue ()
    .closed? = false

;; Pending operations are represented by objects holding
;; a continuation `k` and can be cancelled by having their
;; continuation field deleted.
fun cancel pending ->
  delete pending.k

fun gc q ->
  while ((var p = peek q) && !p.k)
    q = pop q
  q

fun pending-take c ->
  peek (c.taking = gc c.taking)

fun pending-put c ->
  peek (c.putting = gc c.putting)

fun enqueue-put (c, v, k) ->
  var pending = {v: v, k: k}
  c.putting = conj (c.putting, pending)
  pending

fun enqueue-take (c, k) ->
  var pending = {k: k}
  c.taking = conj (c.taking, pending)
  pending

fun complete-pending-take (c, v, p, k) -> do!
  assert! p == peek c.taking
  c.taking = pop c.taking
  mask #-> p.k v
  k true

fun complete-pending-put (c, p, k) -> do!
  assert! p == peek c.putting
  c.putting = pop c.putting
  mask #-> k p.v
  p.k true

#extend TakeChan ManyToManyChan
  try-take! (c, k) ->
    if (c.buffer && ((var v = pop! c.buffer) != null)) do
      k v
      true
    else if (var p = pending-put c) do
      complete-pending-put (c, p, k)
      true
    else if c.closed? do
      k null
      true
    else
      false

  take! (c, k) -> do!
    if !(try-take! (c, k))
      enqueue-take (c, k)

#extend PutChan ManyToManyChan
  try-put! (c, v, k) ->
    if c.closed? do
      k false
      true
    else if (var p = pending-take c) do
      complete-pending-take (c, v, p, k)
      true
    else if (c.buffer && push! (c.buffer, v)) do
      k true
      true
    else
      false

  put! (c, v, k) -> do!
    if !(try-put! (c, v, k))
      enqueue-put (c, v, k)

fun complete-pending-takes c ->
  while (var p = pending-take c)
    complete-pending-take (c, null, p, noop)

#extend CloseChan ManyToManyChan
  close! c -> do!
    if !c.closed?
      c.closed? = true
      complete-pending-takes c

const PENDING = new Object ()

;; A channel that can efficiently and more correctly
;; represent the result of an asynchronous operation.
fun CompletionChan () ->
  #doto this
    .value  = PENDING
    .taking = queue ()

fun completion-chan () ->
  new CompletionChan ()

fun complete! (cc, value) -> do!
  assert! cc.value == PENDING
  if (var p = pending-take cc) do
    cc.value = null
    complete-pending-take (cc, value, p, noop)
    complete-pending-takes cc
  else
    cc.value = value

#extend TakeChan CompletionChan
  fun try-take! (cc, k) ->
    if (cc.value == PENDING)
      false
    else do
      var value = cc.value
      cc.value = null
      k value
      true

  fun take! (cc, k) -> do!
    if !(try-take! (cc, k))
      enqueue-take (cc, k)

;; # The go machine
#defprotocol Instruction
  eval! (i, s, k) ;; Instruction -> ProcessState -> (ProcessState -> Object -> ())

#defrecord ProcessState (process, completion)

fun schedule (instruction, state, k) ->
  #external set-immediate #->
    eval! (instruction, state, k)

fun step (state, previous-instruction-result) ->
  if (var instruction = mask #-> state.process.next previous-instruction-result)
    if instruction.done do
      complete! (state.completion, instruction.value)
    else
      schedule (instruction.value, state, step)
  else
    complete! (state.completion, null)

fun go machine ->
  var process = assert! machine ()
  var completion = completion-chan ()
  step ProcessState (process, completion)
  completion

;; ## Instructions
#defrecord Put  (ch, v)

#defrecord Take ch

#defrecord Alts (operations, options)

fun put (ch, value) ->
  assert! value != null
  Put (ch, value)

fun take ch ->
  Take ch

fun compile operations ->
  operations.map o ->
    if (o instanceof Array)
      put (o[0], o[1])
    else
      take o

fun alts (operations, options) ->
  Alts (compile operations, options)

#extend Instruction Put
  fun eval! ({ch, v}, s, k) ->
    put! (ch, v, success -> k (s, success))

fun eval-take! (ch, s, k) ->
  take! (ch, v -> k (s, v))

#extend Instruction Take
  fun eval! ({ch}, s, k) -> eval-take! (ch, s, k)

;; Treat channels as `Take` instructions
#extend Instruction ManyToManyChan
  eval! (ch, s, k) -> eval-take! (ch, s, k)

#extend Instruction CompletionChan
  eval! (ch, s, k) -> eval-take! (ch, s, k)

;; ### alts
fun enqueue-all (operations, s, k) ->
  var queued = []
  fun cancel! () ->
    queued.for-each cancel
  operations.for-each o ->
    queued.push
      if (o instanceof Put) do
        refer o [ch, v]
        enqueue-put (ch, v, #-> do
          cancel! ()
          k (s, {channel: ch, value: v}))
      else do
        refer o ch
        enqueue-take (ch, v -> do
          cancel! ()
          k (s, {channel: ch, value: v}))

fun try-to-complete (o, s, k) ->
  if (o instanceof Put) do
    refer o [ch, v]
    try-put! (ch, v, #-> k (s, {channel: ch, value: v}))
  else do
    refer o ch
    try-take! (ch, v -> k (s, {channel: ch, value: v}))

fun try-to-complete-some (operations, s, k) ->
  operations |>>
    map o -> try-to-complete (o, s, k)
    some (completed -> completed)

const shuffle! = knuth-shuffle.knuth-shuffle

#extend Instruction Alts
  fun eval! ({operations, options}, s, k) -> do!
    var ops = if (options.?priority) operations else (shuffle! operations)
    if (try-to-complete-some (ops, s, k))
      return
    if (var v = options.?default)
      k (s, {value: v})
    else
      enqueue-all (ops, s, k)

;; ## Collection integration
fun onto (ch, coll, keep-open?) ->
  var s = seq coll
  go #-> do!
    loop (var ss = s)
      if (ss != null) && (yield put (ch, first ss))
        next! (next ss)
    if !keep-open?
      close! ch

fun into (coll, ch) ->
  go #->
    while ((var v = yield ch) != null)
      coll.push v
    coll

;; ## Buffers
fun BoundedBuffer n ->
  #doto this
    .n = n
    .q = queue ()

BoundedBuffer.prototype.pop! =
  #->
    if ((var v = peek this.q) != null) do
      this.q = pop this.q
      v
    else
      null

#extend Buffer BoundedBuffer
  push! (b, v) ->
    if (count b.q < b.n) do
      b.q = conj (b.q, v)
      true
    else
      false

  pop! b -> b.pop! ()

fun SlidingBuffer n ->
  this.n = n

SlidingBuffer.prototype = new BoundedBuffer ()

#extend Buffer SlidingBuffer
  push! (b, v) ->
    b.q = conj (b.q, v)
    if (count b.q > b.n)
      b.q = pop b.q
    true

  pop! b -> b.pop! ()

fun DroppingBuffer n ->
  this.n = n

DroppingBuffer.prototype = new BoundedBuffer ()

#extend Buffer DroppingBuffer
  push! (b, v) ->
    if (count b.q < b.n)
      b.q = conj (b.q, v)
    true

  pop! b -> b.pop! ()

fun number? v ->
  typeof v == ::number

fun sliding-buffer n ->
  assert! number? n
  new SlidingBuffer n

fun dropping-buffer n ->
  assert! number? n
  new DroppingBuffer n

fun buffer n-or-buffer ->
  if (number? n-or-buffer)
    if n-or-buffer > 0
      new BoundedBuffer n-or-buffer
    else
      undefined
  else
    n-or-buffer

fun chan n-or-buffer ->
  new ManyToManyChan (buffer n-or-buffer)

;; ## Utilities
fun put-async (ch, value, maybe-k) ->
  assert! value != null
  put! (ch, value, maybe-k ?? noop)

fun timeout ms ->
  var cc = completion-chan ()
  #external set-timeout
    #-> complete! (cc, null)
    ms
  cc

fun sliding-chan maybe-n ->
  chan sliding-buffer (maybe-n || 1)

fun dropping-chan maybe-n ->
  chan dropping-buffer (maybe-n || 1)

#export
  go
  chan
  close!
  put
  take
  put-async
  alts
  timeout
  onto
  into
  sliding-buffer
  dropping-buffer
  sliding-chan
  dropping-chan
  completion-chan
  complete!
