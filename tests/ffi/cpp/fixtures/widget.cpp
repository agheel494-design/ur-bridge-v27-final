#include "widget.h"

Widget::Widget() : w_(0), h_(0), id_(0), name_("") {}
Widget::Widget(int id) : w_(0), h_(0), id_(id), name_("") {}
Widget::~Widget() {}
void Widget::resize(int w, int h) { w_ = w; h_ = h; }
int Widget::area() const { return w_ * h_; }
int Widget::count() { return 42; }
void Widget::setName(const char* name) { name_ = name; }
const char* Widget::getName() const { return name_; }

namespace shapes {
  Circle::Circle(double radius) : radius_(radius) {}
  double Circle::radius() const { return radius_; }
  void Circle::scale(double factor) { radius_ *= factor; }
}

template<typename T> Box<T>::Box(T value) : val_(value) {}
template<typename T> T Box<T>::get() const { return val_; }
template<typename T> void Box<T>::set(T value) { val_ = value; }

// Explicit instantiation: forces the compiler to emit Box<int>'s methods
// into the shared library, matching how a real template library provides
// explicit instantiations for common types.
template class Box<int>;
