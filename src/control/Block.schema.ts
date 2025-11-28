import {z} from 'zod';


export const OutputSchema = z.object({
    address: z.string(),
    value: z.number(),
}).strict();

export type Output = z.infer<typeof OutputSchema>;
export const InputSchema = z.object({
    txId: z.string(),
    index: z.number(),
}).strict();

export type Input = z.infer<typeof InputSchema>;

export const TransactionSchema = z.object({
    inputs: z.array(InputSchema),
    outputs: z.array(OutputSchema),
    id: z.string(),
}).strict();
export type Transaction = z.infer<typeof TransactionSchema>;


export const BlockSchema = z.object({
    id: z.string(),
    height: z.number(),
    transactions: z.array(TransactionSchema),
}).strict();

export type Block = z.infer<typeof BlockSchema>;