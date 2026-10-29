// Real C++ header for tests/ffi/cpp/cpp-real-native-e2e.test.ts.
// This is what UR-Bridge's bindgen pipeline (parseCppHeader ->
// buildBindingPlan -> itaniumMangle) parses at test time; the resulting
// mangled names are then used to dlsym() into a library compiled from
// widget-impl.cpp.template below — there is no hardcoded/mocked mangled
// name anywhere in this loop.
#ifndef WIDGET_H
#define WIDGET_H

class Widget {
public:
  Widget();
  Widget(int id);
  ~Widget();
  void resize(int w, int h);
  int area() const;
  static int count();
  void setName(const char* name);
  const char* getName() const;
private:
  int w_, h_, id_;
  const char* name_;
};

namespace shapes {
  class Circle {
  public:
    Circle(double radius);
    double radius() const;
    void scale(double factor);
  private:
    double radius_;
  };
}

template<typename T>
class Box {
public:
  Box(T value);
  T get() const;
  void set(T value);
private:
  T val_;
};

#endif
