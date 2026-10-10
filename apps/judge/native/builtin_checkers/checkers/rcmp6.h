#pragma once

#include <testlib.h>
#include <cmath>

// Ported from apps/judge/vendor/testlib/checkers/rcmp6.cpp (identical to UOJ's rcmp6.cpp).
namespace builtin_checker_rcmp6 {

using namespace std;

const double EPS = 1E-6;

inline void builtinCheckerRcmp6()
{
    setName("compare two sequences of doubles, max absolute or relative  error = %.7f", EPS);

    int n = 0;
    double j = 0, p = 0;

    while (!ans.seekEof())
    {
        n++;
        j = ans.readDouble();
        p = ouf.readDouble();
        if (!doubleCompare(j, p, EPS))
        {
            quitf(_wa, "%d%s numbers differ - expected: '%.7f', found: '%.7f', error = '%.7f'",
                n, englishEnding(n).c_str(), j, p, doubleDelta(j, p));
        }
    }

    if (n == 1)
        quitf(_ok, "found '%.7f', expected '%.7f', error '%.7f'", p, j, doubleDelta(j, p));

    quitf(_ok, "%d numbers", n);
}

}
