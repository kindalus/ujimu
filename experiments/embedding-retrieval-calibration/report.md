# Embedding retrieval calibration

Generated: 2026-09-08T08:08:40.024Z

## Scope

- Model: `Xenova/multilingual-e5-small`, int8, 384 dimensions.
- Runtime: `@huggingface/transformers@3.8.1`.
- ONNX weights SHA-256: `4d24e2bc01a447951524466ef533e52944bf48509e6552810bcee1a2711cb02c`.
- Prefix: `query:` on canonical and candidate questions.
- Corpus: 200 cases, 100 positive and 100 negative.
- Data: public/synthetic legal-domain questions; no production question history.
- Execution: isolated experiment; no application dependency or production integration.

## Recommendation

- Pairwise E5 threshold: 0.9127194589055693.
- Ranked E5 score threshold: 0.9061727645372892.
- Ranked E5 top-two margin: 0.004086153382154123.
- Five-fold ranked F1: 0.7867298578199052.

These values are calibrated on synthetic questions. Validate them on a separately reviewed sample before runtime adoption.

## Decision

- E5 ranked cross-validation F1: 0.7867298578199052; trigram: 0.5671641791044776.
- E5 ranked cross-validation errors: 28 false positives and 17 false negatives.
- E5 improves retrieval on this corpus, but the false-positive rate is too high for unguarded runtime adoption.
- Treat the score and margin as calibration candidates, not production defaults.

## Current runtime trigram policy

At the existing 0.85 threshold and without a margin, trigram Dice returned 0 of 100 positive matches and 0 false positives.

The comparison below also shows trigram Dice at its own best-F1 threshold. That separates algorithm capacity from the current conservative runtime policy.

## Full-corpus comparison

| Method | Pair threshold | Pair precision | Pair recall | Pair F1 | Retrieval threshold | Margin | Retrieval precision | Retrieval recall | Retrieval F1 | Top-1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| E5 | 0.9127194589055693 | 0.8053097345132744 | 0.91 | 0.8544600938967136 | 0.9061727645372892 | 0.004086153382154123 | 0.7377049180327869 | 0.9 | 0.8108108108108109 | 0.94 |
| Trigram Dice | 0.2708333333333333 | 0.711864406779661 | 0.84 | 0.7706422018348624 | 0.34951456310679613 | 0.05212903225806448 | 0.6304347826086957 | 0.58 | 0.6041666666666666 | 0.7 |

## Cross-validation

| Method | Pair precision | Pair recall | Pair F1 | Retrieval precision | Retrieval recall | Retrieval F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| E5 | 0.7692307692307693 | 0.9 | 0.8294930875576036 | 0.7477477477477478 | 0.83 | 0.7867298578199052 |
| Trigram Dice | 0.6456692913385826 | 0.82 | 0.7224669603524229 | 0.5643564356435643 | 0.57 | 0.5671641791044776 |

## E5 retrieval by specialty

| Specialty | Precision | Recall | F1 | Accuracy |
| --- | ---: | ---: | ---: | ---: |
| customs | 0.6785714285714286 | 0.76 | 0.7169811320754716 | 0.74 |
| invoicing | 0.7333333333333333 | 0.88 | 0.8 | 0.82 |
| labour | 0.7272727272727273 | 0.96 | 0.8275862068965517 | 0.8 |
| vat | 0.8064516129032258 | 1 | 0.8928571428571429 | 0.88 |

## False positives

- `customs-value-n1` [pairwise/full, pairwise/fold-0]: Que taxa de câmbio deve constar da declaração aduaneira?
- `import-duty-calculation-n1` [pairwise/full, pairwise/fold-0, retrieval/full, retrieval/fold-0]: Como é calculado o IVA cobrado na importação?
- `import-duty-calculation-n3` [pairwise/full, pairwise/fold-2]: Quais mercadorias beneficiam de isenção de direitos aduaneiros?
- `import-duty-calculation-n4` [pairwise/full, pairwise/fold-3, retrieval/full, retrieval/fold-3]: Quando se aplicam direitos anti-dumping a produtos importados?
- `import-declaration-documents-n3` [pairwise/full, pairwise/fold-2, retrieval/full, retrieval/fold-2]: Que produtos precisam de licença de importação prévia?
- `credit-note-correction-n4` [pairwise/full, pairwise/fold-3, retrieval/full, retrieval/fold-3]: As notas de crédito usam a mesma série numérica das facturas?
- `invoice-retention-n4` [pairwise/full, pairwise/fold-3, retrieval/full, retrieval/fold-3]: É obrigatório manter cópias de segurança do arquivo de facturação?
- `invoice-numbering-n1` [pairwise/full, pairwise/fold-0]: É permitido criar uma nova série de facturação a meio do ano?
- `invoice-numbering-n5` [pairwise/full, pairwise/fold-4, retrieval/full, retrieval/fold-4]: O programa que atribui números às facturas precisa de certificação?
- `proforma-validity-n3` [pairwise/full, pairwise/fold-2, retrieval/full, retrieval/fold-2]: As facturas pro forma precisam de numeração própria?
- `overtime-pay-n1` [pairwise/full, pairwise/fold-0, retrieval/full, retrieval/fold-0]: O trabalhador pode recusar-se a fazer horas extraordinárias?
- `overtime-pay-n3` [pairwise/full, pairwise/fold-2, retrieval/full, retrieval/fold-2]: Qual é o número máximo de horas extraordinárias permitido?
- `overtime-pay-n4` [pairwise/full, pairwise/fold-3, retrieval/full, retrieval/fold-3]: As horas extra podem ser trocadas por descanso compensatório?
- `overtime-pay-n5` [pairwise/full, pairwise/fold-4, retrieval/full, retrieval/fold-4]: Como deve a empresa registar o trabalho extraordinário realizado?
- `annual-leave-duration-n1` [pairwise/full, pairwise/fold-0, retrieval/full, retrieval/fold-0]: Quem escolhe as datas em que o trabalhador goza férias?
- `annual-leave-duration-n5` [pairwise/full, pairwise/fold-4, retrieval/full, retrieval/fold-4]: As férias anuais podem ser repartidas por vários períodos?
- `vat-standard-rate-n1` [pairwise/full, pairwise/fold-0]: Que bens beneficiam de uma taxa reduzida de IVA?
- `vat-standard-rate-n3` [pairwise/full, pairwise/fold-2]: Que valores integram a base tributável do IVA?
- `vat-monthly-return-deadline-n1` [pairwise/full, pairwise/fold-0, retrieval/full, retrieval/fold-0]: Qual é o prazo para pagar o IVA já declarado?
- `vat-monthly-return-deadline-n3` [pairwise/full, pairwise/fold-2, retrieval/full, retrieval/fold-2]: Quando deve ser apresentada a declaração anual de informação fiscal?
- `vat-monthly-return-deadline-n5` [pairwise/full, pairwise/fold-4, retrieval/full, retrieval/fold-4]: Quem está dispensado de apresentar declarações periódicas de IVA?
- `vat-exemptions-n4` [pairwise/full, pairwise/fold-3, retrieval/full, retrieval/fold-3]: As operações isentas devem constar da declaração periódica?
- `invoice-retention-n2` [pairwise/fold-1, retrieval/full, retrieval/fold-1]: Em que local devem ser guardados os documentos fiscais?
- `invoice-numbering-n2` [pairwise/fold-1, retrieval/full, retrieval/fold-1]: A numeração pode recomeçar quando muda o exercício?
- `annual-leave-duration-n2` [pairwise/fold-1, retrieval/full, retrieval/fold-1]: É possível acumular férias de um ano para o seguinte?
- `annual-leave-duration-n3` [pairwise/fold-2]: Como se calcula a remuneração durante as férias?
- `annual-leave-duration-n4` [pairwise/fold-3, retrieval/full, retrieval/fold-3]: O que acontece se o trabalhador adoecer durante as férias?
- `customs-value-n5` [retrieval/full]: Em que momento são cobradas despesas de armazenagem portuária?
- `tariff-classification-n3` [retrieval/full, retrieval/fold-2]: É possível pedir uma informação pautal vinculativa antes da importação?
- `import-declaration-documents-n1` [retrieval/full]: Quem pode actuar como despachante aduaneiro em nome do importador?
- `import-declaration-documents-n2` [retrieval/full, retrieval/fold-1]: Qual é o prazo para entregar a declaração depois da chegada da carga?
- `maternity-leave-duration-n1` [retrieval/full]: Que pausas para amamentação são concedidas depois do regresso ao trabalho?
- `vat-input-deduction-n5` [retrieval/full]: Quando caduca um crédito de IVA não utilizado?
- `vat-invoice-elements-n2` [retrieval/full, retrieval/fold-1]: A factura pode ser emitida numa língua estrangeira?

## False negatives

- `tariff-classification-p3` [pairwise/full, pairwise/fold-2, retrieval/full, retrieval/fold-2]: Como classificar um artigo na nomenclatura pautal?
- `tariff-classification-p5` [pairwise/full, pairwise/fold-4]: Em que rubrica aduaneira deve ser enquadrado um produto importado?
- `proof-of-origin-p1` [pairwise/full, pairwise/fold-0, retrieval/full, retrieval/fold-0]: Como posso provar o país de origem dos bens na alfândega?
- `proof-of-origin-p5` [pairwise/full, pairwise/fold-4, retrieval/fold-4]: Como se comprova perante a alfândega a origem dos produtos?
- `overtime-pay-p5` [pairwise/full, pairwise/fold-4, retrieval/fold-4]: Qual é a remuneração legal do trabalho suplementar?
- `termination-notice-p1` [pairwise/full, pairwise/fold-0, retrieval/fold-0]: Com quanto tempo de antecedência deve ser comunicada a cessação do contrato?
- `termination-notice-p3` [pairwise/full, pairwise/fold-2, retrieval/full, retrieval/fold-2]: Que antecedência deve respeitar quem denuncia o contrato de trabalho?
- `vat-input-deduction-p1` [pairwise/full, pairwise/fold-0, retrieval/fold-0]: Quando pode uma empresa descontar o IVA pago aos fornecedores?
- `vat-exemptions-p2` [pairwise/full]: Quais actividades beneficiam de isenção do imposto sobre o valor acrescentado?
- `import-duty-calculation-p5` [pairwise/fold-4, retrieval/fold-4]: De que elementos depende o valor dos direitos a pagar por bens importados?
- `invoice-numbering-p5` [pairwise/fold-4, retrieval/fold-4]: A lei exige números sucessivos para cada factura emitida?
- `import-duty-calculation-p2` [retrieval/full, retrieval/fold-1]: Como saber quanto vou pagar de direitos aduaneiros pela mercadoria?
- `proof-of-origin-p4` [retrieval/full, retrieval/fold-3]: Que documento atesta onde foram produzidos os artigos importados?
- `proforma-validity-p3` [retrieval/full, retrieval/fold-2]: Pode usar-se uma factura pro forma para cumprir a obrigação de facturar?
- `invoice-retention-p1` [retrieval/fold-0]: Qual é o período obrigatório de arquivo das facturas?

## Wrong matches

- `tariff-classification-p5` [retrieval/full, retrieval/fold-4]: Em que rubrica aduaneira deve ser enquadrado um produto importado?
- `import-declaration-documents-p3` [retrieval/full, retrieval/fold-2]: O que tem de acompanhar a declaração aduaneira de mercadorias importadas?
- `invoice-issue-deadline-p1` [retrieval/full, retrieval/fold-0]: Até quando deve ser passada a factura depois da venda?
- `invoice-retention-p5` [retrieval/full, retrieval/fold-4]: Qual é o prazo legal de retenção das facturas da empresa?

## Timing

- Model load: 567.25 ms.
- 220 embeddings: 305.54 ms, 1.389 ms/text average.

## Dependency status

- The disposable lab pinned `@huggingface/transformers@3.8.1`.
- Its isolated install reported two high-severity advisories through `sharp <0.35.0`: https://github.com/advisories/GHSA-f88m-g3jw-g9cj.
- All 54 installed packages had valid registry signatures; nine had attestations.
- The package was not added to the application. Production adoption remains blocked until a reviewed version removes those advisories.

## Sources

- https://huggingface.co/intfloat/multilingual-e5-small
- https://huggingface.co/docs/transformers.js/api/pipelines
