# Reviewer A:

## "The Related Work section is brief and dwells more the historical context."

A paragraph has been added (*lines 1349 to 1358*) to include the multi-tier FRP work, and following suggestions from other reviewers, the Related Work and Discussion sections have been expanded.

# Reviewer B:

## "Croquet appears to be deprecated".

A footnote (*on page 6*) has been added to clarify the status of the library. THe paper solely uses the open-source Croquet library. The commercial companies and their extensions are not relevant.

## "The paper never defines what a glitch is"

A sentence that summarizes the technical term glitch in the FRP context has been added (*line 300*), and the line in question has been expanded to refer to it (*line 1074*).

## "the proposed approach ... relies on assumptions such shared random seed, synchronized clock, and identical window size".

As stated in Section Croquet, Croquet installs a deterministic seeded random number generator, which can be used without modifying code. A sentence has been added to clarify that it is transparent to the application developer, as the system replaces Math.random during model code execution (*line 701*).

A sentence has been added to mention that Croquet does not rely on a synchronized clock. The reflector advances the logical time in one place and sends it to participants (*line 796*).

A sentence has also been added to mention that it does not rely on having identical window sizes (*line 720*). The model stores the logical application state, and the view uses it to actually display things in the local browser windows.

## "If this mapping [between view-to-model/model-to-view events and Events/ Behaviors] is meant to be a central idea of the pape

A paragraph has been added to clarify that the distinction between Events and Behaviors determines what values are usable to compute consistent application state and view at a logical time (*line 1450*).

## "Division of labor with Croquet (p.2)"

Croquet does not avoid the server altogether. It avoids running application-specific code on the server. The sentence on *line 849* indicates that Renkon can be seen as yet another surface language for Croquet.

## "Events.timer(20) (p.4). What does this expression evaluate to? "

An explanation has been added (*line 365*). Events.timer(20) evaluates to the quantized logical elapsed time since the program started running. In this case, the values on the event streams are 20, 40, 60, etc.

## "Publish on tick (p.8). The point of saying the counter is propagated to other clients upon tick (this.publish("counter", "changed")) isn't clear; please explain what this is illustrating."

Sentences have been added to clarify that counter is *not* propagated to other clients upon tick (*line 843*). The clients compute the value for counter bit-identically upon receiving a user event from the reflector or a reflector-generated tick. The model-to-view event, which does not go through the network (*line 732*), requests the local view to update the display. As the view has access to the model, the published model-to-view event does not have to have any payload.

## "Use-before-definition (p.8). In the Behaviors.collect example, change is used before it is defined (const change = Events.or(...) appears after the collect call). Is this intentional/legal in Renkon? "

Yes, it is legal, as stated in the Renkon section. A sentence has been added (*line 903*) to recall that the textual order of node definitions does not matter.

## ""gradually" (p.12). What is meant by developing an application that starts single-user and gradually gains multi-user features. "

A simply transformed application would works as the starting point. It functions but typically lacks multi-user-specific features, such as showing other users' presence. The developers manually implements these features. A sentence has been added to clarify that such features can be added manually, and typically without requiring a complete rearchitecting, because the language has imposed certain styles from the beginning.

## Anomyzation "p.11: the reference "As described in the Data Structure section of [17]" appears to de-anonymize the authors."

The paper simply refers to a section in an existing paper, without claiming any authorship relationship.

## Anomyzation "The online demo, while potentially useful, risks de-anonymizing reviewers who access it."

The authors avoid investigating access logs. While encouraged, accessing the demo site is optional for reviewers.

## "p.7: the cross-reference to "lines 10 and 14" appears to should be lines 12 and 16."

"Lines 10 and 14" is correct. The "publish" lines on those lines send a model-to-view event. A sentence has been added (*line 821*) to clarify this.

## "p.9: the cross-reference to "lines 39 and 44" appears to should be lines 44 and 50."

Indeed, The annotation has been fixed.

# Reviewer C:

## "The paragraph on lines 150-160 seems to make a very strong claim that I don't feel is fully backed up in the paper."

The original paragraph does not have to be read as a Renkon-specific statement. There are many general-purpose FRP languages, and these have shown that FRP provides a basis for clean organization of application code.
The paragraph (*lines 149--162*) has been revised so that the common features of any FRP language and Renkon-specific features are separated.

## A challenge here is the novelty is unclear.

A subsection has been added (*Section 6.3 from line 1441 to 1472*). The subsection describes a list of "key ingredients" that developers and users of other languages and systems to learn more abstractly from this experiment. There is also a paragraph that states that implementing collaboration and live programming capability typically requires a ground-up design to support them. It is a word of caution that these key ingredients themselves are not a prescription for making a successful system.

## "The approach relies on the reflection server which is basically a serialization queue."

A subsection has been added to clarify the limitation of the approach (*Section 6.2, from line 1410 to 1439*). The subsection explicitly states that the "network-first" assumption is substantial, and Croquet in theory has a single point of failure. But it also discusses mitigating factors such as session migration from one reflector to another, and having a very small network component in practice alleviates the issue with single point of failure.

# Administrator's Comments:

## Expand on the discussion section and explain more about the implications of this work, in particular what principles coming from this work could be applied to other languages or settings.

A subsection has been added to clarify the limitation of the approach (*Section 6.2, from line 1410 to 1439*). The subsection explicitly states that the "network-first" assumption is substantial, and Croquet in theory has a single point of failure. But it also discusses mitigating factors such as session migration from one reflector to another, and having a very small network component in practice alleviates the issue with single point of failure.

In conjunction with Subsection 6.3 ("distilled architectural ingredients"), it guides the reader to see what insights could be applied to other languages and systems.

## Clarify "what should a reader take away that is independent of Renkon and Croquet specifically" (RB), or provide a rich reflection why such a comparison is not meaningful or appropriate (either in the paper itself or in a revision comment to the reviewers).

Subsection 6.3 describes the "key ingredients" that we believe made this approach successful.
The list of ingredients offers developers and users of other languages and systems a way to learn more abstractly from this experiment. There is also a paragraph that states that implementing collaboration and live programming capability typically requires a ground-up design to support them. It is a word of caution that these key ingredients themselves are not a prescription for making a successful system.

## Discuss the practical limitations of the approach advocated by this paper that were listed by Reviewer C.

Subsection 6.2 discusses the limitations and assumptions of the approach.



