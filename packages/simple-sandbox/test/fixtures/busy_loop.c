// Burns CPU forever. Used to exercise the time limit.
int main(void)
{
    volatile unsigned long sink = 0;
    for (;;)
        sink++;
    return 0;
}
