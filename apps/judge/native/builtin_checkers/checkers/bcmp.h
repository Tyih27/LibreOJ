#pragma once

#include <testlib.h>
#include <cstdio>

// Ported from /home/tyih/HHHOJ/judger/uoj_judger/builtin/checker/bcmp.cpp, which is not a testlib checker: it opens
// both files itself and writes its verdict directly to stderr. To fit the builtin-checker worker we read the output /
// answer paths from the testlib streams (`ouf.name` / `ans.name`, which the worker initialised from the same files)
// and keep the byte-by-byte algorithm and messages verbatim. Its messages ("wrong answer ..." / "ok ...") are
// already recognised by `parseTestlibMessage`, so the semantics are preserved exactly.
namespace builtin_checker_bcmp {

inline const char *englishEnding(int x)
{
    x %= 100;
    if (x / 10 == 1)
        return "th";
    if (x % 10 == 1)
        return "st";
    if (x % 10 == 2)
        return "nd";
    if (x % 10 == 3)
        return "rd";
    return "th";
}

inline void builtinCheckerBcmp()
{
    FILE *fout = fopen(ouf.name.c_str(), "r");
    FILE *fans = fopen(ans.name.c_str(), "r");

    if (fout == NULL || fans == NULL)
        return;

    int n = 0;
    while (true)
    {
        n++;
        int c, d;
        c = fgetc(fout);
        d = fgetc(fans);
        if (c == EOF && d == EOF)
            break;
        if (c != d)
        {
            if (c == EOF)
                fprintf(stderr, "wrong answer %d%s byte differ - expected EOF found '%c'\n", n, englishEnding(n), (char)d);
            else if (d == EOF)
                fprintf(stderr, "wrong answer %d%s byte differ - expected '%c' found EOF\n", n, englishEnding(n), (char)c);
            else
                fprintf(stderr, "wrong answer %d%s byte differ - expected '%c' found '%c'\n", n, englishEnding(n), (char)c, (char)d);
            fclose(fout);
            fclose(fans);
            return;
        }
    }

    if (n == 0)
        fprintf(stderr, "ok empty file\n");
    else if (n == 1)
        fprintf(stderr, "ok single byte\n");
    else
        fprintf(stderr, "ok %d byte\n", n);
    fclose(fout);
    fclose(fans);
}

}
