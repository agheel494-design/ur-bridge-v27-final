#ifndef EXCEPTION_LAB_H
#define EXCEPTION_LAB_H

// One class, one method per exception-mapping case (per the Phase 7
// Exception Mapping directive's required coverage matrix). Each method
// throws when called with a non-zero trigger value, and returns a
// deterministic success value (value*2) when called with 0 — so every
// case can be exercised through both its success path and its throwing
// path.
class ExceptionLab {
public:
  int throwsRuntimeError(int trigger);
  int throwsLogicErrorBase(int trigger);      // throws std::logic_error directly (not a derived type)
  int throwsInvalidArgument(int trigger);
  int throwsOutOfRange(int trigger);
  int throwsExceptionBase(int trigger);       // throws std::exception directly (the root type)
  int throwsCustomException(int trigger);     // throws a user-defined type deriving from std::exception
  int throwsUnknownValue(int trigger);        // throws a raw int — NOT derived from std::exception at all
};

#endif
