#pragma once

#include <testlib.h>

// Ported from apps/judge/vendor/testlib/checkers/wcmp.cpp (identical to UOJ's wcmp.cpp).
namespace builtin_checker_wcmp {

using namespace std;

inline void builtinCheckerWcmp()
{
    setName("compare sequences of tokens");

    int n = 0;
    string j, p;

    while (!ans.seekEof() && !ouf.seekEof())
    {
        n++;

        ans.readWordTo(j);
        ouf.readWordTo(p);

        if (j != p)
            quitf(_wa, "%d%s words differ - expected: '%s', found: '%s'", n, englishEnding(n).c_str(), compress(j).c_str(), compress(p).c_str());
    }

    if (ans.seekEof() && ouf.seekEof())
    {
        if (n == 1)
            quitf(_ok, "\"%s\"", compress(j).c_str());
        else
            quitf(_ok, "%d tokens", n);
    }
    else
    {
        if (ans.seekEof())
            quitf(_wa, "Participant output contains extra tokens");
        else
            quitf(_wa, "Unexpected EOF in the participants output");
    }
}

}
