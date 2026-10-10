#pragma once

#include <testlib.h>
#include <string>
#include <vector>
#include <sstream>

// Ported from apps/judge/vendor/testlib/checkers/lcmp.cpp (identical to UOJ's lcmp.cpp).
namespace builtin_checker_lcmp {

using namespace std;

bool compareWords(string a, string b)
{
    vector<string> va, vb;
    stringstream sa;

    sa << a;
    string cur;
    while (sa >> cur)
        va.push_back(cur);

    stringstream sb;
    sb << b;
    while (sb >> cur)
        vb.push_back(cur);

    return (va == vb);
}

inline void builtinCheckerLcmp()
{
    setName("compare files as sequence of tokens in lines");

    std::string strAnswer;

    int n = 0;
    while (!ans.eof())
    {
        std::string j = ans.readString();

        if (j == "" && ans.eof())
          break;

        std::string p = ouf.readString();
        strAnswer = p;

        n++;

        if (!compareWords(j, p))
            quitf(_wa, "%d%s lines differ - expected: '%s', found: '%s'", n, englishEnding(n).c_str(), compress(j).c_str(), compress(p).c_str());
    }

    if (n == 1)
        quitf(_ok, "single line: '%s'", compress(strAnswer).c_str());

    quitf(_ok, "%d lines", n);
}

}
