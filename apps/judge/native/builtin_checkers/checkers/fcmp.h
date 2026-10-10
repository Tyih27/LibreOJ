#pragma once

#include <testlib.h>
#include <string>
#include <vector>
#include <sstream>

// Ported from apps/judge/vendor/testlib/checkers/fcmp.cpp (identical to UOJ's fcmp.cpp).
namespace builtin_checker_fcmp {

using namespace std;

inline void builtinCheckerFcmp()
{
    setName("compare files as sequence of lines");

    std::string strAnswer;

    int n = 0;
    while (!ans.eof())
    {
        std::string j = ans.readString();

        if (j == "" && ans.eof())
          break;

        strAnswer = j;
        std::string p = ouf.readString();

        n++;

        if (j != p)
            quitf(_wa, "%d%s lines differ - expected: '%s', found: '%s'", n, englishEnding(n).c_str(), compress(j).c_str(), compress(p).c_str());
    }

    if (n == 1)
        quitf(_ok, "single line: '%s'", compress(strAnswer).c_str());

    quitf(_ok, "%d lines", n);
}

}
