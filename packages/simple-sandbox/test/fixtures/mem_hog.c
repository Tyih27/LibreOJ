#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Allocates and touches 1 MiB chunks until it is OOM-killed by the cgroup
// memory limit, or reaches 2 GiB.
int main(void)
{
    const size_t chunk = 1024 * 1024;
    size_t total = 0;

    for (int i = 0; i < 2048; i++)
    {
        char *p = (char *)malloc(chunk);
        if (p == NULL)
        {
            fprintf(stderr, "malloc failed after %zu bytes\n", total);
            return 2;
        }
        memset(p, (int)(i & 0xff), chunk);
        total += chunk;
    }

    printf("allocated %zu bytes without hitting the limit\n", total);
    return 0;
}
