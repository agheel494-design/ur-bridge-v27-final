#include "exception-lab.h"
#include <stdexcept>
#include <exception>

int ExceptionLab::throwsRuntimeError(int trigger) {
  if (trigger) throw std::runtime_error("runtime_error occurred");
  return trigger * 2;
}

int ExceptionLab::throwsLogicErrorBase(int trigger) {
  if (trigger) throw std::logic_error("logic_error occurred");
  return trigger * 2;
}

int ExceptionLab::throwsInvalidArgument(int trigger) {
  if (trigger) throw std::invalid_argument("invalid_argument occurred");
  return trigger * 2;
}

int ExceptionLab::throwsOutOfRange(int trigger) {
  if (trigger) throw std::out_of_range("out_of_range occurred");
  return trigger * 2;
}

int ExceptionLab::throwsExceptionBase(int trigger) {
  if (trigger) throw std::exception();
  return trigger * 2;
}

namespace {
  class MyCustomError : public std::exception {
  public:
    const char* what() const noexcept override { return "custom exception occurred"; }
  };
}

int ExceptionLab::throwsCustomException(int trigger) {
  if (trigger) throw MyCustomError();
  return trigger * 2;
}

int ExceptionLab::throwsUnknownValue(int trigger) {
  if (trigger) throw 42; // not derived from std::exception at all
  return trigger * 2;
}
