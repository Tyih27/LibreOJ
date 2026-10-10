#pragma once

#include <testlib.h>
#include <cmath>

// Ported from apps/judge/vendor/testlib/checkers/rncmp.cpp (identical to UOJ's rncmp.cpp).
namespace builtin_checker_rncmp {

using namespace std;

const double EPS = 1.5E-5;

inline void builtinCheckerRncmp()
{
    setName("compare two sequences of doubles, maximal absolute error = %.10f", EPS);

    int n = 0;
    while (!ans.seekEof())
    {
        n++;
        double j = ans.readDouble();
        double p = ouf.readDouble();
        if (fabs(j - p) > EPS + 1E-15)
            quitf(_wa, "%d%s numbers differ - expected: '%.10f', found: '%.10f'", n, englishEnding(n).c_str(), j, p);
    }

    quitf(_ok, "%d numbers", n);
}

}
