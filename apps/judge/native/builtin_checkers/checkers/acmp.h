#pragma once

#include <testlib.h>
#include <stdio.h>
#include <math.h>

// Ported from apps/judge/vendor/testlib/checkers/acmp.cpp (identical to UOJ's acmp.cpp).
// The `main` wrapper is replaced with `builtinCheckerAcmp`; `registerTestlibCmd(argc, argv)` is dropped because the
// builtin-checker worker already calls `registerTestlib` before invoking this function.
namespace builtin_checker_acmp {

const double EPS = 1.5E-6;

inline void builtinCheckerAcmp()
{
    setName("compare two doubles, maximal absolute error = %.10f", EPS);

    double ja = ans.readDouble();
    double pa = ouf.readDouble();

    if (fabs(ja - pa) > EPS + 1E-15)
        quitf(_wa, "expected %.10f, found %.10f", ja, pa);

    quitf(_ok, "answer is %.10f", ja);
}

}
