#pragma once

#include <testlib.h>
#include <stdio.h>

// Ported from apps/judge/vendor/testlib/checkers/icmp.cpp (identical to UOJ's icmp.cpp).
namespace builtin_checker_icmp {

inline void builtinCheckerIcmp()
{
    setName("compare two signed int%d's", 8 * int(sizeof(int)));

    int ja = ans.readInt();
    int pa = ouf.readInt();

    if (ja != pa)
        quitf(_wa, "expected %d, found %d", ja, pa);

    quitf(_ok, "answer is %d", ja);
}

}
