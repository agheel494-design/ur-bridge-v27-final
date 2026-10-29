#include "parser.h"
#include <stdexcept>

int Parser::parseStrict(int value) const {
  if (value < 0) throw std::invalid_argument("value must be non-negative");
  if (value > 1000) throw std::out_of_range("value too large");
  return value * 2;
}
