#pragma once

#include <testlib.h>
#include <cmath>

// Ported from apps/judge/vendor/testlib/checkers/rcmp.cpp (identical to UOJ's rcmp.cpp).
namespace builtin_checker_rcmp {

using namespace std;

const double EPS = 1E-4;

inline void builtinCheckerRcmp()
{
    setName("compare two sequences of doubles, max absolute or relative error = %.5f", EPS);

    int n = 0;
    double j = 0, p = 0;

    while (!ans.seekEof())
    {
        n++;
        j = ans.readDouble();
        p = ouf.readDouble();
        if (!doubleCompare(j, p, EPS))
        {
            quitf(_wa, "%d%s numbers differ - expected: '%.5f', found: '%.5f', error = '%.5f'",
                n, englishEnding(n).c_str(), j, p, doubleDelta(j, p));
        }
    }

    if (n == 1)
        quitf(_ok, "found '%.5f', expected '%.5f', error '%.5f'", p, j, doubleDelta(j, p));

    quitf(_ok, "%d numbers", n);
}

}
