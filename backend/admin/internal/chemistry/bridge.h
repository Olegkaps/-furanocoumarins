#ifndef FURANO_CHEMISTRY_H
#define FURANO_CHEMISTRY_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
void* furano_parse(const char* smiles, int query, int bonds, int hetero);
int furano_atoms(void* molecule);
int furano_bonds(void* molecule);
int furano_fingerprint(void* molecule, int mode, int32_t* output, int capacity);
void furano_free(void* molecule);
int furano_match(void* target, void* query, int stereo);
#ifdef __cplusplus
}
#endif
#endif
