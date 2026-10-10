#pragma once

#include <testlib.h>
#include <stdio.h>
#include <math.h>

// Ported from apps/judge/vendor/testlib/checkers/dcmp.cpp (identical to UOJ's dcmp.cpp).
namespace builtin_checker_dcmp {

const double EPS = 1E-6;

inline void builtinCheckerDcmp()
{
    setName("compare two doubles, maximal absolute or relative error = %.10f", EPS);

    double ja = ans.readDouble();
    double pa = ouf.readDouble();

    if (!doubleCompare(ja, pa, EPS))
        quitf(_wa, "expected %.10f, found %.10f", ja, pa);

    quitf(_ok, "answer is %.10f", ja);
}

}
