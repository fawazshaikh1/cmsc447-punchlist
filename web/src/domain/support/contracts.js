/**
 * Contract enforcement helpers — JavaScript's stand-in for `interface`.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * This codebase is built on ports and adapters: the domain declares WHAT it
 * needs (a repository, a renderer, a coordinate transformer) and the
 * infrastructure tier supplies HOW. In a language with interfaces, the compiler
 * guarantees an adapter actually satisfies the port it claims to.
 *
 * JavaScript has no interfaces, so we enforce the same guarantees at RUNTIME.
 * The two helpers below turn "you forgot to implement a method" from a
 * mysterious `undefined is not a function` in the middle of a user interaction
 * into a loud, named error at the moment the object is constructed — which,
 * because everything is wired in one composition root, means at application
 * startup.
 *
 * That is a genuinely different failure mode from a compiler, and it is worth
 * being honest about the trade:
 *
 *   compile-time (TypeScript)  caught before the code ever runs
 *   runtime (this file)        caught the first time the object is built
 *
 * For a port implemented once and wired at startup, those are nearly the same
 * thing: a missing method crashes the app immediately and unmistakably, not
 * three weeks later on a tablet in a basement.
 */

/**
 * Enforces that a class is used as an abstract base and that its subclass has
 * overridden every method the contract requires.
 *
 * Call this from the base class constructor:
 *
 *     class AnnotationRepository {
 *       static REQUIRED = ['listBySheet', 'save', 'delete', 'clearSheet'];
 *       constructor() {
 *         enforceContract(this, new.target, AnnotationRepository);
 *       }
 *     }
 *
 * `new.target` is the constructor that was actually invoked with `new`, so it
 * is the subclass when a subclass is being built and the base class itself when
 * somebody tries to instantiate the abstraction directly.
 *
 * @param {object}   instance  The object under construction (`this`).
 * @param {Function} target    `new.target` from the base constructor.
 * @param {Function} baseClass The abstract class declaring the contract.
 * @throws {TypeError} if instantiated directly, or if a method is not overridden.
 */
export function enforceContract(instance, target, baseClass) {
  const contractName = baseClass.name;

  if (target === baseClass) {
    throw new TypeError(
      `${contractName} is an abstract contract and cannot be instantiated directly. ` +
        `Extend it with a concrete implementation in the infrastructure tier.`,
    );
  }

  const required = baseClass.REQUIRED ?? [];

  // A method is "not overridden" when looking it up on the instance resolves to
  // the exact same function object as the base class's own prototype method.
  // Walking the prototype chain this way correctly allows multi-level
  // inheritance (Base -> Middle -> Concrete) to satisfy the contract.
  const missing = required.filter(
    (method) => instance[method] === baseClass.prototype[method],
  );

  if (missing.length > 0) {
    throw new TypeError(
      `${target.name} claims to implement ${contractName} but does not override: ` +
        `${missing.join(', ')}. Every method in ${contractName}.REQUIRED must be provided.`,
    );
  }
}

/**
 * Body for an unimplemented contract method.
 *
 * These should never actually run — `enforceContract` rejects a subclass that
 * failed to override them long before anything can call one. They exist so that
 * the base class documents the full contract in one readable place, and as a
 * final backstop if a method is added to a class but forgotten in REQUIRED.
 *
 * @param {string} contractName
 * @param {string} methodName
 * @returns {never}
 */
export function abstractMethod(contractName, methodName) {
  throw new Error(
    `${contractName}.${methodName}() is abstract and was not implemented by this subclass.`,
  );
}

/**
 * Asserts that a value is an instance of the expected class.
 *
 * ===========================================================================
 * THIS IS THE MOST IMPORTANT FUNCTION IN THE CODEBASE
 * ===========================================================================
 * The single most expensive bug class in a PDF markup application is storing a
 * SCREEN coordinate where a DOCUMENT coordinate belongs. Both are `{x, y}`, so
 * nothing complains. The pins look correct on the developer's laptop and land
 * in the wrong place on a retina tablet, weeks later, with no error to trace.
 *
 * `PdfPoint` and `ViewportPoint` are therefore separate classes, and every
 * boundary between them calls this guard. Mixing them up stops being a silent
 * wrong answer and becomes an immediate, named exception on the very first
 * click — which is when a developer is looking straight at it.
 *
 * @param {unknown}  value
 * @param {Function} expectedClass
 * @param {string}   parameterName Used in the error message.
 * @param {string}   [hint] Extra guidance appended to the message. Pass
 *        COORDINATE_SPACE_HINT at coordinate boundaries; omit it elsewhere, so
 *        a mis-wired repository does not get told about coordinate spaces.
 * @throws {TypeError}
 */
export function assertInstanceOf(value, expectedClass, parameterName, hint = '') {
  if (value instanceof expectedClass) return;

  const actual =
    value === null ? 'null'
    : value === undefined ? 'undefined'
    : (value.constructor?.name ?? typeof value);

  throw new TypeError(
    `Expected ${parameterName} to be a ${expectedClass.name}, received ${actual}.` +
      (hint ? ` ${hint}` : ''),
  );
}

/**
 * Guidance appended when a coordinate-space guard trips.
 *
 * Kept as a named constant so the wording lives in one place and so the call
 * sites that use it are greppable — those are exactly the boundaries where the
 * screen/document distinction is being enforced.
 */
export const COORDINATE_SPACE_HINT =
  'Screen and document coordinates are not interchangeable — convert explicitly ' +
  'through a CoordinateTransformer rather than passing the raw numbers across.';
